import type Stripe from "stripe";

export function safeMembershipPortal(
  configuration: Stripe.BillingPortal.Configuration,
) {
  const features = configuration.features;
  return (
    configuration.active &&
    !configuration.login_page.enabled &&
    features.payment_method_update.enabled &&
    features.subscription_cancel.enabled &&
    features.subscription_cancel.mode === "at_period_end" &&
    !features.subscription_update.enabled &&
    !features.customer_update.enabled
  );
}
