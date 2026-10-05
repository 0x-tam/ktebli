import { stripeId } from "@/lib/billing-policy";
import { throttle } from "@/lib/rate-limit";
import { handle, requireUser, json, HttpError } from "@/lib/http";
import { billingTransaction } from "@/lib/db";
import { stripe, requireBilling, appOrigin } from "@/lib/stripe";
import { accountPath } from "@/lib/paths";
export const POST = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await throttle(user.id, "checkout");
    requireBilling();
    if (!user.emailVerified)
      throw new HttpError(403, "Verify your email before subscribing");
    const api = stripe();
    const priceId = process.env.STRIPE_MEMBERSHIP_PRICE_ID;
    if (!priceId)
      throw new HttpError(503, "Membership price is not configured");
    const price = await api.prices.retrieve(priceId);
    if (
      !price.active ||
      price.currency !== "usd" ||
      price.unit_amount !== 2000 ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1
    )
      throw new HttpError(503, "Membership price needs review");
    const existing = await billingTransaction(
      async (db) =>
        (
          await db.query(
            "SELECT stripe_customer_id FROM membership.customers WHERE user_id=$1",
            [user.id],
          )
        ).rows[0]?.stripe_customer_id as string | undefined,
    );
    const customer =
      existing ??
      (
        await api.customers.create(
          { email: user.email, metadata: { membership_user_id: user.id } },
          { idempotencyKey: `membership-customer:${user.id}` },
        )
      ).id;
    await billingTransaction((db) =>
      db.query(
        "INSERT INTO membership.customers(user_id,stripe_customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
        [user.id, customer],
      ),
    );
    // A durable per-account attempt is shared by concurrent requests and retries.
    let pending = await billingTransaction(async (db) => {
      await db.query(
        "INSERT INTO membership.checkouts(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [user.id],
      );
      return (
        await db.query("SELECT * FROM membership.checkouts WHERE user_id=$1", [
          user.id,
        ])
      ).rows[0];
    });
    if (pending.stripe_session_id) {
      const previous = await api.checkout.sessions.retrieve(
        pending.stripe_session_id,
      );
      if (previous.status === "open") return json({ url: previous.url });
      if (previous.status === "complete") {
        const oldId = stripeId(previous.subscription);
        const oldSub = oldId ? await api.subscriptions.retrieve(oldId) : null;
        if (
          !oldSub ||
          !["canceled", "incomplete_expired"].includes(oldSub.status)
        )
          throw new HttpError(
            409,
            "Your payment is being confirmed or membership is already active. Manage membership from your account.",
          );
      } else if (previous.status !== "expired")
        throw new HttpError(409, "Your previous checkout needs review");
      pending = await billingTransaction(async (db) => {
        await db.query(
          "UPDATE membership.checkouts SET attempt_id=gen_random_uuid(),stripe_session_id=NULL,created_at=now() WHERE user_id=$1 AND attempt_id=$2",
          [user.id, pending.attempt_id],
        );
        return (
          await db.query(
            "SELECT * FROM membership.checkouts WHERE user_id=$1",
            [user.id],
          )
        ).rows[0];
      });
    }
    const subscriptions = await api.subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    if (
      subscriptions.has_more ||
      subscriptions.data.some(
        (s) => !["canceled", "incomplete_expired"].includes(s.status),
      )
    )
      throw new HttpError(
        409,
        "A membership already exists. Manage it from your account.",
      );
    const session = await api.checkout.sessions.create(
      {
        mode: "subscription",
        customer,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: false,
        success_url: `${appOrigin()}${accountPath("/dashboard")}?billing=success`,
        cancel_url: `${appOrigin()}${accountPath("/dashboard")}?billing=canceled`,
        client_reference_id: user.id,
        subscription_data: { metadata: { membership_user_id: user.id } },
        metadata: { kind: "ktebli_membership", attempt_id: pending.attempt_id },
      },
      { idempotencyKey: `membership-checkout:${pending.attempt_id}` },
    );
    await billingTransaction((db) =>
      db.query(
        "UPDATE membership.checkouts SET stripe_session_id=$1 WHERE user_id=$2 AND attempt_id=$3",
        [session.id, user.id, pending.attempt_id],
      ),
    );
    return json({ url: session.url });
  });
