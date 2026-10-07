export type ProposalTier = "draft" | "competitive" | "full";
export type CheckoutIntent = {
  token: string;
  tier: ProposalTier;
  savedAt: number;
};

export const checkoutIntentKey = "ktebli-member-checkout";
export const checkoutIntentMaxAgeMs = 30 * 60 * 1000;

export function validCheckoutIntent(
  value: unknown,
  now = Date.now(),
): value is CheckoutIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.token === "string" &&
    /^[a-f0-9]{48}$/.test(intent.token) &&
    (intent.tier === "draft" ||
      intent.tier === "competitive" ||
      intent.tier === "full") &&
    typeof intent.savedAt === "number" &&
    Number.isFinite(intent.savedAt) &&
    intent.savedAt <= now &&
    now - intent.savedAt <= checkoutIntentMaxAgeMs
  );
}

export function readCheckoutIntent(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
): CheckoutIntent | null {
  try {
    const raw = storage.getItem(checkoutIntentKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (validCheckoutIntent(value, now)) return value;
    storage.removeItem(checkoutIntentKey);
  } catch {
    // Private browsing or disabled storage must not start checkout implicitly.
  }
  return null;
}

export function saveCheckoutIntent(
  storage: Pick<Storage, "setItem">,
  token: string,
  tier: string,
  now = Date.now(),
): CheckoutIntent | null {
  const intent = { token, tier, savedAt: now };
  if (!validCheckoutIntent(intent, now)) return null;
  try {
    storage.setItem(checkoutIntentKey, JSON.stringify(intent));
  } catch {
    // The caller can still keep the validated intent in memory for this page.
  }
  return intent;
}
