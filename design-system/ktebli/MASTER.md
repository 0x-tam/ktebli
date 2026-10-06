# Ktebli interface system

## Product feel

Keep Ktebli editorial, calm, and locally grounded. Use the cream and forest palette with restrained coral accents. Preserve the public site's expressive serif headline and offset card shadows, while keeping account and form surfaces quieter and easier to scan. Prefer specific, established product copy over generic promotional language. Do not add invented testimonials, metrics, or availability claims.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#FAF8F2` | Main page background |
| Surface | `#FFFEFA` | Cards and form fields |
| Ink | `#20392F` | Main text and strong borders |
| Forest | `#284D39` | Primary buttons, links, selected navigation |
| Green | `#356347` | Secondary accents and progress |
| Mint | `#E9EFE4` | Calm status and supporting surfaces |
| Muted | `#59695F` | Secondary text |
| Line | `#D9DED4` | Dividers and quiet boundaries |
| Coral | `#C45141` | Small highlights and decorative emphasis |

White on Forest has a measured contrast ratio of about 9.5:1. Muted text on Paper measures about 5.4:1. Keep Coral decorative or use it with white text only after checking the exact pairing. Keyboard focus uses `#8C5739` or `#9C633D` against the light surfaces; keep a visible 3px outline with offset.

## Typography

- Use Fraunces for display headings and occasional editorial emphasis.
- Use DM Sans for body text, labels, controls, and navigation.
- Load both with `display=swap`; retain Georgia and system sans-serif fallbacks.
- Body copy stays at 16px or larger. Supporting labels may be smaller when they remain readable and have adequate contrast.

## Shape, spacing, and interaction

- Use a 4px base spacing rhythm and favor 8, 12, 16, 24, 32, and 48px steps.
- Public cards may use a restrained 5–6px offset shadow in forest green or coral. Account cards should use light borders and soft elevation.
- Use 8–14px control and card radii. Primary controls have at least 44px height; text inputs use 48px height and 16px type on mobile.
- Provide hover, pressed, disabled, and keyboard focus states without layout shifts.
- Respect `prefers-reduced-motion`. Keep native disclosure behavior visible with a clear chevron when styling removes its default marker.
- Use consistent inline SVGs for navigation symbols, marked decorative with `aria-hidden="true"`; do not use emoji as interface icons.

## Responsive behavior

- Start with a compact, single-column phone layout. No horizontal scrolling at 375–390px.
- Keep navigation, account actions, labels, and form controls reachable at small widths.
- On wide dashboard screens, use the available canvas for the compact opportunity rows and filters instead of centering them in a narrow column.
- Keep the opportunity board's stacked row layout, expandable details, server-side filters, and proposal handoff CTA.

## Product and availability guardrails

- Keep membership availability and billing behavior controlled by the existing runtime flags. Present unavailable checkout as clear status information.
- Preserve source verification and deadline cautions. Do not imply an opportunity is verified when the source state says otherwise.
- Keep proposal checkout, authentication, and payment copy aligned with the existing product state.
- Do not change customer-order provider, backend behavior, or spending claims as part of visual work.
