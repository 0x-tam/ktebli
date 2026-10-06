import type Stripe from "stripe";
export const stripeId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
export function paidCycle(invoice: Stripe.Invoice, priceId: string) {
  const lines = invoice.lines.data;
  if (
    invoice.status !== "paid" ||
    invoice.currency !== "usd" ||
    invoice.amount_paid !== 2000 ||
    invoice.total !== 2000 ||
    invoice.amount_remaining !== 0 ||
    invoice.lines.has_more ||
    lines.length !== 1 ||
    !["subscription_create", "subscription_cycle"].includes(
      invoice.billing_reason ?? "",
    )
  )
    return null;
  const line = lines[0];
  const subscriptionId = stripeId(
    invoice.parent?.subscription_details?.subscription,
  );
  if (
    !subscriptionId ||
    line.quantity !== 1 ||
    line.amount !== 2000 ||
    line.pricing?.price_details?.price !== priceId ||
    line.period.end <= line.period.start
  )
    return null;
  return {
    subscriptionId,
    customerId: stripeId(invoice.customer),
    invoiceId: invoice.id,
    start: new Date(line.period.start * 1000),
    end: new Date(line.period.end * 1000),
  };
}
export function subscriptionState(status: string) {
  return status === "active"
    ? "active"
    : status === "canceled"
      ? "canceled"
      : status === "past_due"
        ? "past_due"
        : "inactive";
}
