import assert from "node:assert/strict";
import test from "node:test";
import {
  checkoutIntentKey,
  checkoutIntentMaxAgeMs,
  readCheckoutIntent,
  saveCheckoutIntent,
  validCheckoutIntent,
} from "../lib/checkout-intent";

test("credit handoff validates tier, token and a short lifetime", () => {
  const now = 1_000_000;
  const valid = { token: "a".repeat(48), tier: "competitive", savedAt: now };
  assert.equal(validCheckoutIntent(valid, now), true);
  assert.equal(validCheckoutIntent({ ...valid, tier: "other" }, now), false);
  assert.equal(validCheckoutIntent({ ...valid, token: "secret" }, now), false);
  assert.equal(
    validCheckoutIntent(valid, now + checkoutIntentMaxAgeMs + 1),
    false,
  );
  assert.equal(validCheckoutIntent({ ...valid, savedAt: now + 1 }, now), false);
});

test("expired or malformed stored handoffs are discarded", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  };
  const now = 1_000_000;
  assert.ok(saveCheckoutIntent(storage, "a".repeat(48), "draft", now));
  assert.equal(readCheckoutIntent(storage, now)?.tier, "draft");
  assert.equal(
    readCheckoutIntent(storage, now + checkoutIntentMaxAgeMs + 1),
    null,
  );
  assert.equal(raw, null);
  raw = JSON.stringify({ token: "b".repeat(48), tier: "full" });
  assert.equal(readCheckoutIntent(storage, now), null);
  assert.equal(raw, null);
});

test("blocked browser storage does not create a false checkout state", () => {
  const storage = {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
    removeItem: () => {
      throw new Error("unavailable");
    },
  };
  assert.equal(readCheckoutIntent(storage), null);
  assert.ok(saveCheckoutIntent(storage, "a".repeat(48), "draft"));
  assert.equal(checkoutIntentKey, "ktebli-member-checkout");
});
