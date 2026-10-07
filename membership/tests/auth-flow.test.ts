import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthRequestTimeoutError,
  codeErrorMessage,
  isCodeError,
  runBoundedAuthCall,
} from "../lib/auth/flow";

test("a completed auth request returns its result without aborting", async () => {
  let requestSignal: AbortSignal | undefined;
  const result = await runBoundedAuthCall(async (signal) => {
    requestSignal = signal;
    return { emailVerified: true };
  }, 100);
  assert.deepEqual(result, { emailVerified: true });
  assert.equal(requestSignal?.aborted, false);
});

test("a slow auth request aborts and cannot return a late success", async () => {
  let resolveLate: ((value: string) => void) | undefined;
  let requestSignal: AbortSignal | undefined;
  const pending = runBoundedAuthCall((signal) => {
    requestSignal = signal;
    return new Promise<string>((resolve) => {
      resolveLate = resolve;
    });
  }, 10);
  await assert.rejects(pending, AuthRequestTimeoutError);
  assert.equal(requestSignal?.aborted, true);
  resolveLate?.("late success");
});

test("wrong, expired and rate-limited codes have specific safe errors", () => {
  assert.equal(
    codeErrorMessage({ code: "INVALID_OTP" }),
    "That code did not work. Check the digits and try again.",
  );
  assert.equal(
    codeErrorMessage({ code: "OTP_EXPIRED" }),
    "This code expired. Request a new code and try again.",
  );
  assert.equal(
    codeErrorMessage({ status: 429 }),
    "Too many attempts. Wait a little before trying again.",
  );
  assert.equal(isCodeError({ code: "OTP_NOT_FOUND" }), true);
  assert.equal(isCodeError({ code: "NETWORK_ERROR" }), false);
});
