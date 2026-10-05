import "server-only";
import Stripe from "stripe";
import { HttpError } from "./http";
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new HttpError(503, "Billing is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 1,
    timeout: 15000,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
export function billingEnabled() {
  return process.env.MEMBERSHIP_BILLING_ENABLED === "true";
}
export function requireBilling() {
  if (!billingEnabled())
    throw new HttpError(
      503,
      "Membership checkout is not open yet. Nothing has been charged.",
    );
}
export function appOrigin() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new HttpError(503, "App origin is not configured");
  return new URL(origin).origin;
}
