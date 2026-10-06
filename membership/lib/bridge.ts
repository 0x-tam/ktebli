import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
export function bridgeHeaders(body: string, secret: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomUUID();
  const digest = createHash("sha256").update(body).digest("hex");
  return {
    "Content-Type": "application/json",
    "x-membership-timestamp": timestamp,
    "x-membership-nonce": nonce,
    "x-membership-signature": createHmac("sha256", secret)
      .update(`${timestamp}.${nonce}.${digest}`)
      .digest("hex"),
  };
}
export function verifyBridge(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const timestamp = headers.get("x-membership-timestamp") ?? "",
    nonce = headers.get("x-membership-nonce") ?? "",
    signature = headers.get("x-membership-signature") ?? "";
  if (
    secret.length < 32 ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[-a-f0-9]{36}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const digest = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${digest}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
