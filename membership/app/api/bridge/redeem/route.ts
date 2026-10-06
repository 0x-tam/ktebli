import { redeemCreditSql } from "@/lib/credit-sql";
import { z } from "zod";
import { handle, readBody, json, HttpError } from "@/lib/http";
import { verifyBridge } from "@/lib/bridge";
import { billingTransaction } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { stripeId } from "@/lib/billing-policy";
import { creditQuote } from "@/lib/contracts";
export const POST = (request: Request) =>
  handle(async () => {
    const raw = await readBody(request);
    const secret = process.env.MEMBERSHIP_BRIDGE_SECRET ?? "";
    if (!verifyBridge(raw, request.headers, secret))
      throw new HttpError(401, "Invalid bridge signature");
    const { session_id } = z
      .object({ session_id: z.string().regex(/^cs_[A-Za-z0-9_]+$/) })
      .strict()
      .parse(JSON.parse(raw));
    const api = stripe();
    const session = await api.checkout.sessions.retrieve(session_id);
    const reservation = session.metadata?.membership_reservation_id;
    if (
      !reservation ||
      session.mode !== "payment" ||
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      session.currency !== "usd" ||
      !session.payment_intent
    )
      throw new HttpError(409, "Settled credit checkout required");
    const intent = await api.paymentIntents.retrieve(
      stripeId(session.payment_intent)!,
    );
    if (!intent.latest_charge)
      throw new HttpError(409, "Settled charge required");
    const charge = await api.charges.retrieve(stripeId(intent.latest_charge)!);
    if (
      !charge.paid ||
      charge.refunded ||
      charge.amount_refunded > 0 ||
      charge.disputed
    )
      throw new HttpError(409, "Payment reversed");
    return billingTransaction(async (db) => {
      const nonce = await db.query(
        "INSERT INTO membership.bridge_nonces(nonce) VALUES($1) ON CONFLICT DO NOTHING RETURNING nonce",
        [request.headers.get("x-membership-nonce")],
      );
      if (!nonce.rowCount) throw new HttpError(409, "Bridge replay rejected");
      const credit = (
        await db.query(
          "SELECT c.*,b.stripe_customer_id FROM membership.credits c JOIN membership.customers b ON b.user_id=c.user_id WHERE c.reservation_id=$1 FOR UPDATE OF c",
          [reservation],
        )
      ).rows[0];
      if (
        !credit ||
        credit.stripe_session_id !== session.id ||
        credit.checkout_token !== session.client_reference_id ||
        credit.tier !== session.metadata?.tier ||
        credit.stripe_customer_id !== stripeId(session.customer) ||
        credit.buyer_email.toLowerCase() !==
          (session.customer_details?.email ?? "").toLowerCase()
      )
        throw new HttpError(409, "Credit checkout binding mismatch");
      const quote = creditQuote(
        credit.tier as "draft" | "competitive" | "full",
      );
      if (
        session.amount_total !== quote.totalCents ||
        session.amount_subtotal !== quote.totalCents ||
        session.total_details?.amount_discount !== 0
      )
        throw new HttpError(409, "Credit amount mismatch");
      if (credit.state === "redeemed") {
        if (credit.order_reference !== session.id)
          throw new HttpError(409, "Credit already used");
      } else {
        // Reservation proves paid-cycle entitlement. Canonical charge time, rather
        // than webhook arrival, decides whether settlement was inside that cycle.
        if (
          credit.state !== "reserved" ||
          charge.created * 1000 < new Date(credit.valid_from).getTime() ||
          charge.created * 1000 >= new Date(credit.expires_at).getTime()
        )
          throw new HttpError(409, "Credit is no longer valid");
        await db.query(redeemCreditSql, [session.id, credit.id]);
      }
      return json({
        ok: true,
        reservation_id: reservation,
        user_id: credit.user_id,
        checkout_token: credit.checkout_token,
        tier: credit.tier,
        session_id: session.id,
        credit_cents: 2000,
        paid_cents: quote.totalCents,
        currency: "usd",
        buyer_email: credit.buyer_email,
      });
    });
  });
