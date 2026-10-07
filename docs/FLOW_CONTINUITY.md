# Ktebli continuous customer journeys

The customer is completing one task. Navigation must preserve that task instead of silently starting another. Keep the existing visual identity; this change concerns sequence, context and recovery.

## Flow contract

1. **Discover:** open the board directly. Signed-out visitors authenticate once and return to the requested account view. Search, country, type, source, status and deadline filters survive Back and refresh. Profile and membership navigation return to the same board state.
2. **Choose an opportunity:** internal Prepare proposal links stay in the same tab and open `/start?prepare=<notice-id>&returnTo=<account-path>`. The focused preparation view shows the selected notice and a clear return. It does not drop the customer into the marketing homepage.
3. **Prepare a proposal:** use the existing source, package, contact and review steps. A package already chosen from pricing remains chosen. Closing and returning resumes the current task. Changing the opportunity or starting another is explicit and invalidates old source clearance.
4. **Review and pay:** show the selected opportunity, deadline, package, deliverables and price before the intentional payment action. Returning from checkout restores entered work; restored client state never grants payment or source clearance. Member checkout remains behind its existing activation gate.
5. **Authenticate:** sign-in, signup and email-code states preserve a validated account destination. A stale checkout record cannot override a normal sign-in. An already authenticated visitor continues without a second login form. Errors stay next to the action and retain safe input.
6. **Membership:** browsing works independently of paid membership. Unavailable features do not look like working primary navigation. Membership details and billing returns preserve the caller's place. No subscription or matching flags are enabled by this UX change.
7. **Complete the paid brief:** the order page remains the place for required details, optional background, progress, files and revisions. A tab-local draft can survive refresh only within the same order and server revision. Successful saves clear the corresponding draft. New server revisions cannot silently receive stale edits.
8. **Recover:** failed fetches, expired sessions, cancelled checkout and browser Back offer a next action without erasing work. A late request must never redirect the user or overwrite a newer task after they close, restart or change context.

## Shared navigation and privacy rules

- `returnTo` is a validated relative account path. Reject external URLs, protocol-relative URLs, backslashes, encoded redirect tricks and unapproved paths. Never trust it as an authorization signal.
- Public preparation returns only to the account dashboard; account auth can return to approved internal account destinations. Stripe callback origins remain server-configured.
- URLs can contain public opportunity IDs and board filters, not contact details, private proposal text, credentials or order capabilities.
- Draft storage is versioned, bounded, short-lived and tab-local. Do not serialize uploaded files or persist provider/session credentials. State from storage is untrusted; validate every field and revalidate authoritative source/payment conditions.
- Session checks and callbacks do not create checkout sessions automatically. Checkout creation requires an intentional user action and retains server idempotency and ownership checks.
- Preserve keyboard focus, accessible status/error feedback, reduced-motion support and readable mobile controls.

## Release evidence

Audit captured live board, profile, public preparation, signed-in-to-login detour and unavailable saved-opportunity states. Initial findings are tied to the numbered local screenshots under `/private/tmp/ktebli-flow-audit/`. Authentication submission, real payment and customer order mutations must use isolated fixtures for this task; report their limits separately from live navigation checks.

Before release: inspect the final diff, run relevant website and membership tests plus types/lint/build, exercise Back/refresh/retry on desktop and mobile, and obtain a fresh independent Sol high review of auth, checkout and draft-continuity changes. Keep actual final verification in the release report rather than treating this plan as proof.
