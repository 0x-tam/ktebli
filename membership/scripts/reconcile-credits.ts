import { expireRevokedCheckout } from "../lib/checkout-expiry";
import { Pool } from "pg";
import Stripe from "stripe";
import {
  releaseCreditSql,
  bindReconciledSessionSql,
  releaseOrphanCreditSql,
} from "../lib/credit-sql";
if (!process.env.STRIPE_SECRET_KEY || !process.env.BILLING_DATABASE_URL)
  throw new Error("Billing reconciliation is not configured");
const api = new Stripe(process.env.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 1,
  timeout: 15000,
});
const pool = new Pool({ connectionString: process.env.BILLING_DATABASE_URL });
const db = await pool.connect();
try {
  await db.query("SET ROLE membership_billing");
  const rows = (
    await db.query(
      "SELECT c.id,c.state,COALESCE(c.reservation_id::text,c.checkout_request #>> '{metadata,membership_reservation_id}') AS reservation_id,c.stripe_session_id,c.checkout_expires_at,b.stripe_customer_id FROM membership.credits c JOIN membership.customers b ON b.user_id=c.user_id WHERE c.state='reserved' OR (c.state='revoked' AND c.checkout_resolution IS NULL AND (c.stripe_session_id IS NOT NULL OR c.checkout_request IS NOT NULL)) ORDER BY c.reserved_at LIMIT 100",
    )
  ).rows;
  const review = await db.query(
    "SELECT id FROM membership.credits WHERE checkout_resolution='paid_review' LIMIT 100",
  );
  for (const row of review.rows)
    console.warn(
      JSON.stringify({
        credit: row.id,
        status: "revoked_paid_operator_review",
      }),
    );
  for (const row of rows) {
    let session: Stripe.Checkout.Session | null = row.stripe_session_id
      ? await api.checkout.sessions.retrieve(row.stripe_session_id)
      : null;
    let exhausted = false;
    if (!session) {
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await api.checkout.sessions.list({
          customer: row.stripe_customer_id,
          limit: 100,
          ...(cursor ? { starting_after: cursor } : {}),
        });
        session =
          batch.data.find(
            (s) => s.metadata?.membership_reservation_id === row.reservation_id,
          ) ?? null;
        if (session || !batch.has_more) {
          exhausted = !batch.has_more;
          break;
        }
        cursor = batch.data.at(-1)?.id;
      }
      if (session && row.state === "reserved")
        await db.query(bindReconciledSessionSql, [
          session.id,
          row.id,
          row.reservation_id,
          row.checkout_expires_at,
        ]);
    }
    if (row.state === "revoked") {
      const resolution = session
        ? await expireRevokedCheckout(api, session.id)
        : exhausted &&
            Number(row.checkout_expires_at) * 1000 < Date.now() - 3600000
          ? "expired"
          : null;
      if (resolution)
        await db.query(
          "UPDATE membership.credits SET checkout_resolution=$1 WHERE id=$2 AND state='revoked' AND COALESCE(reservation_id::text,checkout_request #>> '{metadata,membership_reservation_id}') IS NOT DISTINCT FROM $3",
          [resolution, row.id, row.reservation_id],
        );
      console.log(
        JSON.stringify({
          credit: row.id,
          status: resolution ?? "revoked_expiry_pending",
        }),
      );
      continue;
    }
    if (session?.status === "expired" && session.payment_status === "unpaid") {
      await db.query(releaseCreditSql, [row.id, session.id]);
      console.log(
        JSON.stringify({ credit: row.id, status: "released_expired" }),
      );
    } else if (
      !session &&
      exhausted &&
      row.checkout_expires_at &&
      Number(row.checkout_expires_at) * 1000 < Date.now() - 3600000
    ) {
      await db.query(releaseOrphanCreditSql, [
        row.id,
        row.reservation_id,
        row.checkout_expires_at,
      ]);
      console.log(
        JSON.stringify({
          credit: row.id,
          status: "released_no_session_after_expiry",
        }),
      );
    } else
      console.log(
        JSON.stringify({
          credit: row.id,
          status:
            session?.payment_status === "paid"
              ? "paid_replay_proposal_webhook"
              : (session?.status ?? "requires_review"),
        }),
      );
  }
} finally {
  db.release();
  await pool.end();
}
