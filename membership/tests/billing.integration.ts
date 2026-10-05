import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
const socket = process.env.MEMBERSHIP_TEST_PG_SOCKET;
if (!socket?.startsWith("/private/tmp/"))
  throw new Error("Disposable local Postgres required");
process.env.BILLING_DATABASE_URL = `postgresql://membership_test_billing@localhost/membership_test?host=${encodeURIComponent(socket)}&port=55439`;
process.env.STRIPE_SECRET_KEY = "sk_test_fixture_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_only";
process.env.STRIPE_MEMBERSHIP_PRICE_ID = "price_fixture";
const db = new Pool({
  host: socket,
  port: 55439,
  user: "membership_test_billing",
  database: "membership_test",
});
let refunded = false;
let proposalMode = false;
let expireSucceeded = false;
let expiryCalls = 0;
const proposalReservation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const settledBeforeExpiry = Math.floor(Date.now() / 1000) - 60;
const customer = "cus_fixture",
  sub = "sub_fixture",
  invoiceId = "in_fixture",
  user = "fixture-user",
  attempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const start = Math.floor(Date.now() / 1000) - 3600,
  end = start + 30 * 86400;
const invoice = {
  id: invoiceId,
  status: "paid",
  currency: "usd",
  amount_paid: 2000,
  total: 2000,
  amount_remaining: 0,
  billing_reason: "subscription_cycle",
  customer,
  parent: { subscription_details: { subscription: sub } },
  lines: {
    has_more: false,
    data: [
      {
        quantity: 1,
        amount: 2000,
        pricing: { price_details: { price: "price_fixture" } },
        period: { start, end },
      },
    ],
  },
};
const oldFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (!url.startsWith("https://api.stripe.com/"))
    throw new Error("Unexpected outbound call");
  let data: unknown;
  if (url.includes("/v1/checkout/sessions/cs_revoked")) {
    if (url.endsWith("/expire")) expiryCalls++;
    data = {
      id: "cs_revoked",
      status: url.endsWith("/expire") && expireSucceeded ? "expired" : "open",
      payment_status: "unpaid",
    };
  } else if (url.includes("/v1/invoices/")) data = invoice;
  else if (url.includes("/v1/subscriptions/"))
    data = { id: sub, customer, status: "active", cancel_at_period_end: false };
  else if (proposalMode && url.includes("/v1/checkout/sessions/"))
    data = {
      id: "cs_proposal",
      status: "complete",
      mode: "payment",
      payment_status: "paid",
      currency: "usd",
      payment_intent: "pi_fixture",
      customer,
      client_reference_id: "token_fixture",
      metadata: {
        membership_reservation_id: proposalReservation,
        tier: "draft",
      },
      customer_details: { email: "member@example.com" },
      amount_total: 12900,
      amount_subtotal: 12900,
      total_details: { amount_discount: 0 },
    };
  else if (url.includes("/v1/checkout/sessions/"))
    data = {
      id: "cs_fixture",
      status: "complete",
      mode: "subscription",
      subscription: sub,
      customer,
      client_reference_id: user,
      metadata: { attempt_id: attempt },
    };
  else if (url.includes("/v1/invoice_payments"))
    data = {
      object: "list",
      has_more: false,
      data: [
        {
          invoice: invoiceId,
          payment: { type: "payment_intent", payment_intent: "pi_fixture" },
        },
      ],
    };
  else if (url.includes("/v1/payment_intents/"))
    data = { id: "pi_fixture", latest_charge: "ch_fixture" };
  else if (url.includes("/v1/charges/"))
    data = {
      id: "ch_fixture",
      payment_intent: "pi_fixture",
      amount_refunded: refunded ? 2000 : 0,
      disputed: false,
      paid: true,
      created: settledBeforeExpiry,
    };
  else throw new Error("Unexpected Stripe route");
  return Response.json(data, { headers: { "request-id": "req_fixture" } });
};
test("real webhook + SQL handles duplicate and out-of-order invoice/refund events", async () => {
  try {
    await db.query("SET ROLE membership_billing");
    await db.query(
      "INSERT INTO membership.customers(user_id,stripe_customer_id) VALUES($1,$2)",
      [user, customer],
    );
    await db.query(
      "INSERT INTO membership.checkouts(user_id,attempt_id,stripe_session_id) VALUES($1,$2,'cs_fixture')",
      [user, attempt],
    );
    const { POST } = await import("../app/api/billing/webhook/route");
    async function event(id: string, type: string, object: unknown) {
      const body = JSON.stringify({ id, type, data: { object } }),
        timestamp = Math.floor(Date.now() / 1000),
        signature = createHmac("sha256", "whsec_fixture_only")
          .update(`${timestamp}.${body}`)
          .digest("hex");
      return POST(
        new Request("https://membership.test/api/billing/webhook", {
          method: "POST",
          headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
          body,
        }),
      );
    }
    assert.equal(
      (await event("evt_invoice", "invoice.paid", { id: invoiceId })).status,
      200,
    );
    assert.equal(
      (await event("evt_invoice", "invoice.paid", { id: invoiceId })).status,
      200,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM membership.credits WHERE user_id=$1",
            [user],
          )
        ).rows[0].count,
      ),
      1,
    );
    await db.query(
      "UPDATE membership.credits SET state='reserved',reservation_id=gen_random_uuid(),stripe_session_id='cs_revoked' WHERE user_id=$1",
      [user],
    );
    refunded = true;
    assert.equal(
      (await event("evt_refund", "charge.refunded", { id: "ch_fixture" }))
        .status,
      200,
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM membership.credits WHERE user_id=$1",
          [user],
        )
      ).rows[0].state,
      "revoked",
    );
    assert.equal(
      expiryCalls,
      1,
      "refund immediately attempts canonical open checkout expiry",
    );
    assert.equal(
      (
        await db.query(
          "SELECT checkout_resolution FROM membership.credits WHERE user_id=$1",
          [user],
        )
      ).rows[0].checkout_resolution,
      null,
      "unconfirmed expiry remains durably pending",
    );
    expireSucceeded = true;
    assert.equal(
      (await event("evt_refund_retry", "charge.refunded", { id: "ch_fixture" }))
        .status,
      200,
    );
    assert.equal(
      (
        await db.query(
          "SELECT checkout_resolution FROM membership.credits WHERE user_id=$1",
          [user],
        )
      ).rows[0].checkout_resolution,
      "expired",
      "repeated refund retries pending checkout expiry",
    );
    assert.equal(
      (await event("evt_invoice_late", "invoice.paid", { id: invoiceId }))
        .status,
      503,
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM membership.subscriptions WHERE user_id=$1",
          [user],
        )
      ).rows[0].state,
      "inactive",
    );
    // Simulate a stale charge read after a reversal was committed: tombstone wins.
    refunded = false;
    assert.equal(
      (await event("evt_invoice_stale", "invoice.paid", { id: invoiceId }))
        .status,
      200,
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM membership.credits WHERE user_id=$1",
          [user],
        )
      ).rows[0].state,
      "revoked",
    );
    const admin = new Pool({
      host: socket,
      port: 55439,
      user: "Tamam",
      database: "membership_test",
    });
    try {
      await admin.query("DELETE FROM membership.credits WHERE user_id=$1", [
        user,
      ]);
    } finally {
      await admin.end();
    }
    assert.equal(
      (
        await event("evt_invoice_after_refund", "invoice.paid", {
          id: invoiceId,
        })
      ).status,
      200,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM membership.credits WHERE user_id=$1",
            [user],
          )
        ).rows[0].count,
      ),
      0,
    );
    // Delivery after cycle expiry still honors a canonical charge settled inside the reserved cycle.
    proposalMode = true;
    process.env.MEMBERSHIP_BRIDGE_SECRET =
      "fixture-bridge-secret-with-at-least-32-characters";
    await db.query(
      "INSERT INTO membership.credits(user_id,invoice_id,valid_from,expires_at,state,reservation_id,stripe_session_id,checkout_token,tier,buyer_email) VALUES($1,'in_delayed',to_timestamp($2-3600),to_timestamp($2+30),'reserved',$3,'cs_proposal','token_fixture','draft','member@example.com')",
      [user, settledBeforeExpiry, proposalReservation],
    );
    const { POST: redeem } = await import("../app/api/bridge/redeem/route");
    const { bridgeHeaders } = await import("../lib/bridge");
    async function redeemRequest() {
      const body = JSON.stringify({ session_id: "cs_proposal" });
      return redeem(
        new Request("https://membership.test/api/bridge/redeem", {
          method: "POST",
          body,
          headers: bridgeHeaders(body, process.env.MEMBERSHIP_BRIDGE_SECRET!),
        }),
      );
    }
    assert.equal((await redeemRequest()).status, 200);
    assert.equal(
      (await redeemRequest()).status,
      200,
      "same settled session redemption is idempotent after expiry",
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM membership.credits WHERE invoice_id='in_delayed'",
        )
      ).rows[0].state,
      "redeemed",
    );
    refunded = true;
    assert.equal(
      (await redeemRequest()).status,
      409,
      "reversed canonical proposal payment is rejected",
    );
  } finally {
    globalThis.fetch = oldFetch;
    await db.end();
    const { dbPool } = await import("../lib/db");
    await dbPool(true).end();
  }
});
