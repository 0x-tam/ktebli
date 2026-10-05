import { expireRevokedCheckout } from "@/lib/checkout-expiry";
import { releaseCreditSql } from "@/lib/credit-sql";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { handle, json, readBody, HttpError } from "@/lib/http";
import { billingTransaction } from "@/lib/db";
import { paidCycle, stripeId, subscriptionState } from "@/lib/billing-policy";
export const POST = (request: Request) => {
  const context = { eventId: "unverified", eventType: "unverified" };
  return handle(
    async () => {
      const api = stripe();
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new HttpError(503, "Webhook is not configured");
      let event: Stripe.Event;
      try {
        event = api.webhooks.constructEvent(
          await readBody(request, 128000),
          request.headers.get("stripe-signature") ?? "",
          secret,
        );
      } catch {
        throw new HttpError(400, "Invalid webhook");
      }
      context.eventId = event.id.slice(0, 100);
      context.eventType = event.type;
      if (event.type === "checkout.session.expired") {
        const session = await api.checkout.sessions.retrieve(
          event.data.object.id,
        );
        if (
          session.status === "expired" &&
          session.payment_status === "unpaid" &&
          session.metadata?.membership_reservation_id
        )
          await billingTransaction(async (db) => {
            const credit = (
              await db.query(
                "SELECT id FROM membership.credits WHERE reservation_id=$1 AND stripe_session_id=$2",
                [session.metadata?.membership_reservation_id, session.id],
              )
            ).rows[0];
            if (credit)
              await db.query(releaseCreditSql, [credit.id, session.id]);
          });
        return json({ ok: true });
      }
      if (event.type === "invoice.paid") {
        const invoice = await api.invoices.retrieve(event.data.object.id);
        const cycle = paidCycle(
          invoice,
          process.env.STRIPE_MEMBERSHIP_PRICE_ID ?? "",
        );
        if (!cycle) return json({ ignored: true });
        const verifiedAt = new Date();
        const sub = await api.subscriptions.retrieve(cycle.subscriptionId);
        if (
          stripeId(sub.customer) !== cycle.customerId ||
          sub.status !== "active"
        )
          return json({ ignored: true });
        const binding = await billingTransaction(
          async (db) =>
            (
              await db.query(
                "SELECT c.user_id,k.stripe_session_id,k.attempt_id FROM membership.customers c JOIN membership.checkouts k ON k.user_id=c.user_id WHERE c.stripe_customer_id=$1",
                [cycle.customerId],
              )
            ).rows[0],
        );
        if (!binding?.stripe_session_id)
          throw new Error("Missing checkout binding");
        const checkout = await api.checkout.sessions.retrieve(
          binding.stripe_session_id,
        );
        if (
          checkout.status !== "complete" ||
          checkout.mode !== "subscription" ||
          stripeId(checkout.subscription) !== cycle.subscriptionId ||
          stripeId(checkout.customer) !== cycle.customerId ||
          checkout.client_reference_id !== binding.user_id ||
          checkout.metadata?.attempt_id !== binding.attempt_id
        )
          throw new Error("Checkout binding mismatch");
        const payments = await api.invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 100,
        });
        if (
          payments.has_more ||
          payments.data.length !== 1 ||
          payments.data[0].payment.type !== "payment_intent"
        )
          throw new Error("Payment needs review");
        const intent = await api.paymentIntents.retrieve(
          stripeId(payments.data[0].payment.payment_intent)!,
        );
        if (!intent.latest_charge) throw new Error("Missing charge");
        const charge = await api.charges.retrieve(
          stripeId(intent.latest_charge)!,
        );
        if (charge.amount_refunded > 0 || charge.disputed || !charge.paid)
          throw new Error("Payment was reversed");
        await billingTransaction(async (db) => {
          await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            "membership-invoice:" + cycle.invoiceId,
          ]);
          if (
            (
              await db.query(
                "SELECT 1 FROM membership.payment_reversals WHERE invoice_id=$1",
                [cycle.invoiceId],
              )
            ).rowCount
          )
            return;
          const duplicate = await db.query(
            "INSERT INTO membership.webhook_events(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
            [event.id, event.type],
          );
          if (!duplicate.rowCount) return;
          const customer = (
            await db.query(
              "SELECT user_id FROM membership.customers WHERE stripe_customer_id=$1 FOR UPDATE",
              [cycle.customerId],
            )
          ).rows[0];
          if (!customer) throw new Error("Unknown membership customer");
          const known = (
            await db.query(
              "SELECT stripe_subscription_id,state,paid_until FROM membership.subscriptions WHERE user_id=$1",
              [customer.user_id],
            )
          ).rows[0];
          if (
            known &&
            known.stripe_subscription_id !== cycle.subscriptionId &&
            !(
              known.state === "canceled" &&
              new Date(known.paid_until) <= new Date()
            )
          )
            throw new Error("Duplicate subscription needs operator review");
          // Only a Checkout initiated by this application can create an entitlement.
          const pending = (
            await db.query(
              "SELECT stripe_session_id FROM membership.checkouts WHERE user_id=$1",
              [customer.user_id],
            )
          ).rows[0];
          if (!known && !pending?.stripe_session_id)
            throw new Error("Missing checkout binding");
          const entitlement = await db.query(
            `INSERT INTO membership.subscriptions(user_id,stripe_subscription_id,state,paid_until,cancel_at_period_end) VALUES($1,$2,'active',$3,$4) ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id=EXCLUDED.stripe_subscription_id,state='active',paid_until=GREATEST(membership.subscriptions.paid_until,$3),cancel_at_period_end=$4,updated_at=now() WHERE membership.subscriptions.updated_at<=$5 RETURNING user_id`,
            [
              customer.user_id,
              cycle.subscriptionId,
              cycle.end,
              sub.cancel_at_period_end,
              verifiedAt,
            ],
          );
          if (!entitlement.rowCount)
            throw new Error(
              "Subscription changed during payment verification; retry",
            );
          await db.query(
            `INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(invoice_id) DO NOTHING`,
            [customer.user_id, cycle.invoiceId, cycle.start, cycle.end],
          );
        });
        return json({ ok: true });
      }
      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const sub = await api.subscriptions.retrieve(event.data.object.id);
        await billingTransaction(async (db) => {
          await db.query(
            "UPDATE membership.subscriptions SET state=$1,cancel_at_period_end=$2,updated_at=now() WHERE stripe_subscription_id=$3",
            [subscriptionState(sub.status), sub.cancel_at_period_end, sub.id],
          );
          if (sub.status !== "active")
            await db.query(
              "UPDATE membership.credits SET state='revoked',reservation_id=NULL,order_reference=NULL WHERE user_id=(SELECT user_id FROM membership.subscriptions WHERE stripe_subscription_id=$1) AND state='available'",
              [sub.id],
            );
        });
        return json({ ok: true });
      }
      if (
        event.type === "charge.refunded" ||
        event.type === "charge.dispute.created"
      ) {
        const charge =
          event.type === "charge.refunded"
            ? await api.charges.retrieve(event.data.object.id)
            : await api.charges.retrieve(stripeId(event.data.object.charge)!);
        const paymentIntent = stripeId(charge.payment_intent);
        if (!paymentIntent) return json({ ignored: true });
        const payments = await api.invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: paymentIntent },
          limit: 100,
        });
        const membershipInvoices: string[] = [];
        for (const payment of payments.data) {
          const invoiceId = stripeId(payment.invoice);
          if (!invoiceId) continue;
          const invoice = await api.invoices.retrieve(invoiceId);
          if (paidCycle(invoice, process.env.STRIPE_MEMBERSHIP_PRICE_ID ?? ""))
            membershipInvoices.push(invoiceId);
        }
        const revoked = await billingTransaction(async (db) => {
          const rows: { id: string; stripe_session_id: string | null }[] = [];
          for (const invoiceId of membershipInvoices) {
            await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
              "membership-invoice:" + invoiceId,
            ]);
            await db.query(
              "INSERT INTO membership.payment_reversals(invoice_id) VALUES($1) ON CONFLICT DO NOTHING",
              [invoiceId],
            );
            await db.query(
              "UPDATE membership.subscriptions SET state='inactive',updated_at=now() WHERE user_id=(SELECT user_id FROM membership.credits WHERE invoice_id=$1)",
              [invoiceId],
            );
            const result = await db.query(
              "UPDATE membership.credits SET state='revoked',reservation_id=NULL,order_reference=NULL WHERE invoice_id=$1 AND state IN ('available','reserved','revoked') RETURNING id,stripe_session_id",
              [invoiceId],
            );
            rows.push(...result.rows);
          }
          return rows;
        });
        for (const credit of revoked) {
          if (!credit.stripe_session_id) continue;
          try {
            const resolution = await expireRevokedCheckout(
              api,
              credit.stripe_session_id,
            );
            if (resolution)
              await billingTransaction((db) =>
                db.query(
                  "UPDATE membership.credits SET checkout_resolution=$1 WHERE id=$2 AND state='revoked' AND stripe_session_id=$3",
                  [resolution, credit.id, credit.stripe_session_id],
                ),
              );
            if (resolution === "paid_review")
              console.error(
                JSON.stringify({
                  code: "revoked_credit_paid_review",
                  creditId: credit.id,
                }),
              );
          } catch {
            console.error(
              JSON.stringify({
                code: "revoked_checkout_expiry_pending",
                creditId: credit.id,
              }),
            );
          }
        }
        return json({ ok: true });
      }
      return json({ ignored: true });
    },
    () =>
      console.error(
        JSON.stringify({ code: "membership_webhook_failed", ...context }),
      ),
  );
};
