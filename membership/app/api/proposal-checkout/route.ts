import {
  persistCheckoutRequestSql,
  bindCreatedCheckoutSql,
} from "@/lib/credit-sql";
import { throttle } from "@/lib/rate-limit";
import { reserveCreditSql, releaseCreditSql } from "@/lib/credit-sql";
import { z } from "zod";
import {
  handle,
  requireUser,
  requireMember,
  readJson,
  json,
  HttpError,
} from "@/lib/http";
import { billingTransaction } from "@/lib/db";
import { accountPath } from "@/lib/paths";
import { stripe, appOrigin } from "@/lib/stripe";
import { creditQuote } from "@/lib/contracts";
import { bridgeHeaders } from "@/lib/bridge";
export const POST = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await throttle(user.id, "proposal");
    await requireMember(user.id);
    if (!user.emailVerified)
      throw new HttpError(403, "Verify your email first");
    if (process.env.MEMBERSHIP_CREDIT_BRIDGE_ENABLED !== "true")
      throw new HttpError(503, "Proposal credit checkout is not open yet");
    const { token, tier } = z
      .object({
        token: z.string().regex(/^[a-f0-9]{48}$/),
        tier: z.enum(["draft", "competitive", "full"]),
      })
      .strict()
      .parse(await readJson(request));
    const secret = process.env.MEMBERSHIP_BRIDGE_SECRET;
    const endpoint = process.env.SUPABASE_MEMBER_VALIDATE_URL;
    if (!secret || secret.length < 32 || !endpoint)
      throw new HttpError(503, "Credit checkout is not configured");
    const body = JSON.stringify({
      checkout_token: token,
      tier,
      email: user.email,
      user_id: user.id,
    });
    const validation = await fetch(endpoint, {
      method: "POST",
      headers: bridgeHeaders(body, secret),
      body,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!validation.ok)
      throw new HttpError(
        422,
        "The intake must be ready and use your verified account email",
      );
    const api = stripe();
    const pendingCredit = await billingTransaction(
      async (db) =>
        (
          await db.query(
            "SELECT id,stripe_session_id FROM membership.credits WHERE user_id=$1 AND state='reserved' AND stripe_session_id IS NOT NULL ORDER BY reserved_at DESC LIMIT 1",
            [user.id],
          )
        ).rows[0],
    );
    if (pendingCredit) {
      const pendingSession = await api.checkout.sessions.retrieve(
        pendingCredit.stripe_session_id,
      );
      if (
        pendingSession.status === "expired" &&
        pendingSession.payment_status === "unpaid"
      )
        await billingTransaction((db) =>
          db.query(releaseCreditSql, [pendingCredit.id, pendingSession.id]),
        );
    }
    const credit = await billingTransaction(async (db) => {
      // Account lock makes reservation idempotent across simultaneous requests.
      const customer = (
        await db.query(
          "SELECT stripe_customer_id FROM membership.customers WHERE user_id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!customer) throw new HttpError(409, "Billing account is missing");
      const existing = (
        await db.query(
          "SELECT * FROM membership.credits WHERE user_id=$1 AND checkout_token=$2",
          [user.id, token],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.tier !== tier ||
          existing.buyer_email !== user.email ||
          !["reserved", "redeemed"].includes(existing.state)
        )
          throw new HttpError(409, "Credit reservation needs review");
        return { ...existing, customer: customer.stripe_customer_id };
      }
      const result = await db.query(reserveCreditSql, [
        user.id,
        token,
        tier,
        user.email,
      ]);
      if (!result.rows[0])
        throw new HttpError(
          409,
          "No usable credit is available for this cycle",
        );
      return { ...result.rows[0], customer: customer.stripe_customer_id };
    });
    if (credit.stripe_session_id) {
      const old = await api.checkout.sessions.retrieve(
        credit.stripe_session_id,
      );
      if (old.status === "open") return json({ url: old.url });
      if (old.status === "complete")
        throw new HttpError(409, "Your payment has already been submitted");
      if (old.status === "expired" && old.payment_status === "unpaid") {
        await billingTransaction((db) =>
          db.query(releaseCreditSql, [credit.id, old.id]),
        );
        throw new HttpError(
          409,
          "The old checkout expired. Please try again to use your credit.",
        );
      }
      throw new HttpError(409, "Checkout needs review");
    }
    const stripeCustomer = await api.customers.retrieve(credit.customer);
    if (
      stripeCustomer.deleted ||
      stripeCustomer.email?.toLowerCase() !== user.email.toLowerCase()
    )
      throw new HttpError(
        409,
        "Your billing email must match your verified account email. Update it in Manage membership first.",
      );
    const quote = creditQuote(tier);
    const site = new URL(
      process.env.PROPOSAL_SITE_ORIGIN ?? "https://ktebli.vercel.app",
    ).origin;
    const candidate = {
      mode: "payment",
      customer: credit.customer,
      client_reference_id: token,
      customer_update: { name: "auto" },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: quote.totalCents,
            product_data: {
              name: `Ktebli ${tier} proposal — $20 membership credit applied`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        tier,
        membership_reservation_id: credit.reservation_id,
        membership_credit_cents: "2000",
      },
      success_url: `${site}/orders/session/{CHECKOUT_SESSION_ID}`,
      cancel_url: `${appOrigin()}${accountPath("/dashboard")}`,
      expires_at: Number(credit.checkout_expires_at),
    } as const;
    const stored = await billingTransaction(
      async (db) =>
        (
          await db.query(persistCheckoutRequestSql, [
            JSON.stringify(candidate),
            credit.id,
            credit.reservation_id,
            token,
            tier,
            credit.buyer_email,
            credit.checkout_expires_at,
          ])
        ).rows[0],
    );
    if (!stored || stored.reservation_id !== credit.reservation_id)
      throw new HttpError(409, "Credit is no longer reserved");
    const session = await api.checkout.sessions.create(
      stored.checkout_request,
      { idempotencyKey: `proposal-credit:${credit.reservation_id}` },
    );
    const bound = await billingTransaction((db) =>
      db.query(bindCreatedCheckoutSql, [
        session.id,
        credit.id,
        credit.reservation_id,
      ]),
    );
    if (bound.rowCount !== 1) {
      try {
        if (session.status === "open")
          await api.checkout.sessions.expire(session.id);
      } catch {
        console.error(
          JSON.stringify({
            code: "unbound_checkout_expiry_failed",
            sessionId: session.id,
          }),
        );
      }
      throw new HttpError(
        409,
        "Your credit changed while checkout was being prepared. Please review your membership.",
      );
    }
    return json({ url: session.url });
  });
