# Customer journey continuity — 7 October 2026

## Scope and decisions
Keep Ktebli’s existing cream/green design. Connect discovery, authentication, preparation, checkout and paid work around the customer’s current task. No new subscription activation, matching activation, database migration, price or payment-authorization changes.

Official TypeSafe Jev routed implementation to ESCALATE (GPT-6 Sol, high), confidence 0.97. Two Sol high agents implemented public/paid and account journeys; a fresh independent Sol high agent reviewed the final changes. Routing evidence: flow-rethink-routing.json. Review evidence is recorded separately with file hashes.

## Eight journeys
1. Discovery: country/type/search and account tabs have URL history and survive refresh. Original notice remains an external link; Prepare proposal stays in the same tab.
2. Opportunity to proposal: focused /start view carries the selected opportunity and a validated return to the board.
3. Preparation: a selected pricing package remains visible and skips repeated package selection. Closing/reopening and refresh recover a bounded tab-local draft. Starting another proposal requires an in-page confirmation.
4. Review/payment: opportunity, package, deliverables, deadline and price remain together. Late clearance responses cannot redirect after the customer closes or changes the task. No automatic credit checkout POST on mount.
5. Account access: existing verified sessions continue directly; explicit safe return destinations survive authentication. Old checkout storage cannot hijack generic sign-in.
6. Membership/settings: unavailable Saved/Alerts are removed from free-account primary navigation. Billing return context is retained. Existing disabled checkout gates remain in place.
7. Paid brief: same-order, same-server-revision drafts recover after refresh. Changed source revisions require explicit recovery. Successful saves clear the corresponding draft.
8. Changes/recovery: revision requests retain unsent work, handle uncertain submissions and avoid silently resending. Errors retain context and offer a next step.

## Browser evidence
Live-before: opportunity board, profile, redundant signed-in login form, unavailable Saved dead end, public package restart behavior.
Isolated-after: selected Full package skips repeated package step; contact details and review survive refresh; inline restart confirmation retains work when canceled; 375px mobile preparation view inspected; profile Back and refresh retain unsaved changes with realistic database metadata; signed-in auth returns to requested profile; credit checkout stays on an explicit package summary; paid work description and language survive refresh; changed source revision displays explicit saved-draft recovery and restores only on click.

Initial checks found and fixed real failures: profile remount lost unsaved edits; paid draft validation mismatched repeater keys/numeric revision shapes. Native restart confirmation was replaced with an accessible in-page confirmation. These failures were retested successfully.

## Deterministic evidence
Membership: typecheck, lint, formatter check and production build pass. Unit suite: 33 pass, one optional source-artifact test skipped. Public: all seven website checks, inline JavaScript syntax, static build and diff checks pass.

## Limits
Paid/auth mutation paths use isolated fixtures. No real charge, OTP email, customer profile save, proposal generation or revision submission was made for this UX verification. Guest Stripe payment-link cancel behavior remains provider-configured; recovery relies on the retained draft when returning in the same tab. Session drafts expire and are not cross-device permanent storage. Browser screenshots with account information remain local and are not committed. The existing revision endpoint has no idempotency key: the UI requires a fresh status check and explicit retry, but exact-once retry remains a backend limitation.

## Deployment
Independent fresh Sol high review passed on the final file hashes. Production release is pending; deployment IDs and live checks are appended after success.
