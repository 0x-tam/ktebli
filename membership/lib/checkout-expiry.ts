import type Stripe from "stripe";
export async function expireRevokedCheckout(
  api: Stripe,
  sessionId: string,
): Promise<"expired" | "paid_review" | null> {
  const session = await api.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === "paid") return "paid_review";
  if (session.status === "expired" && session.payment_status === "unpaid")
    return "expired";
  if (session.status === "open" && session.payment_status === "unpaid") {
    const expired = await api.checkout.sessions.expire(session.id);
    return expired.status === "expired" && expired.payment_status === "unpaid"
      ? "expired"
      : null;
  }
  return null;
}
