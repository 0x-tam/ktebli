# Ktebli interaction brief

Make every step feel calm, immediate and predictable. Preserve the cream/forest editorial identity and concise conversion journey. One clear action per screen; optional detail appears on request. Use popups for opportunity details and the proposal flow, never unsolicited promotion.

## Motion and controls

- Shared timing: 120ms pressed feedback, 180ms small transitions, 240ms surface entrances. Use ease-out, opacity and small transforms; no bouncing, scroll hijacking or decorative delay.
- Buttons, links, tabs, filters and disclosures need consistent hover, pressed, keyboard-focus and disabled states. Touch actions work without hover; targets remain at least 44px.
- Inline SVGs use one outline style, consistent sizing and decorative accessibility semantics beside text. Icon-only controls retain an accessible name.
- Reduced-motion preferences remove spatial movement and looping decoration while retaining explicit loading/status text.
- Dialogs enter and leave gently, preserve native focus trapping where available, close with Escape and restore focus. Form steps move focus into the new step without discarding inputs.

## Asynchronous behaviour

- Every meaningful wait has a truthful pending state, followed by a visible success or actionable inline error. Never fabricate progress or completion.
- Keep board geometry stable during filtering. Clearly identify pending results; preserve latest-request-wins, cache and retry behaviour. Avoid blank flashes and duplicate actions.
- Auth and save actions respond immediately, prevent duplicate requests, retain values on failure and preserve existing server checks.
- Order polling must not reset open disclosures, revisions, typed input, focus or caret. Identical updates should not replace the interface. Requests must not race into stale state.
- Revision errors belong next to the action, not in browser alerts. Pending revision state survives polling. Intake submissions keep current revision and source-language safeguards.

## Scope and verification matrix

| Surface | Required checks |
| --- | --- |
| Public navigation, pricing, sample and disclosures | Hover/press/focus, disclosure/tab transitions, keyboard operation |
| Proposal popup and four steps | Open/close/Escape/focus return, repeated navigation, package selection, retained input |
| Opportunity preview | Pending, success, recoverable failure, truthful facts and deadline confirmation |
| Account board | Fast repeated filters, loading stability, empty/error/retry, details dialog, preparation CTA |
| Auth and profile | Pending/success/error affordances, duplicate protection, values retained, no real submissions in UI QA |
| Paid order | Repeated polling while typing/disclosing, stale responses, pending revision, inline errors, original submission contracts |
| Cross-cutting | 375/390/desktop widths, keyboard focus, reduced motion, no overflow, relevant tests/build/lint/type/format |
| Release | Fresh independent Sol high review of async/auth/payment-adjacent changes, scoped deployment, live public/auth checks |

Keep backend, billing flags, prices, deliverables, language rules and customer-order model providers unchanged. Use isolated fixtures for paid and signed-in interactions; label fixture evidence distinctly from live checks. Completion requires checking the whole matrix, not merely adding CSS transitions.
