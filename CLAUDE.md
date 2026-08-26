# Ktebli

Fully automated, pay-per-proposal grant-writing service. Tagline: "Proposals like no other, ever."

Front end on Vercel. Back end is Supabase: Postgres + a job queue + edge functions (Deno).
Models via OpenRouter. Email via Resend. Payments via Stripe.

- Supabase project ref: `uocauqflcqefgdixbzpf`
- Pricing: Draft $149 · Competitive $299 · Full $449
- Worker version deployed at handoff: **v26**

## Repo layout

```
supabase/functions/    all 8 edge functions, as deployed
db/schema.sql          reference dump: tables, indexes, functions, triggers, RLS, cron
index.html             Vercel front end: landing + intake wizard
order.html             order page
tests/replay/          replays every migration into a throwaway Postgres and asserts parity
tests/exclusivity/     probes the real per-grant ceiling by calling claim_approach() directly
render-service/        docx render + page-count service (Dockerfile + server.mjs) — NOT YET DEPLOYED
reports/               engineering and launch-readiness reports
DEPLOY.md              CLI commands to deploy each function
BLUEPRINT.md           long-form product and architecture history
```

## Source-of-truth warning

`supabase/functions/worker/` was verified byte-identical to deployed v26, and **no longer is** —
it carries undeployed changes (stranded-claim release, terminal-failure notification, two
typing-only assertions). Deployed is still v26. `supabase/migrations/` is likewise ahead of
production by `20260826150000`. `tests/replay/run.sh` reports exactly which schema categories
are undeployed; there is no equivalent check for the functions, so diff before deploying.

The other seven functions were transcribed from API output and have **not** been byte-verified.
Before touching any of them, re-pull the authoritative copy:

```
supabase functions download <slug>
```

and treat that as the base. Do not deploy a transcribed copy without checking it first.

## Deploy discipline — keep this

Every worker deploy in this project is verified byte-for-byte against local source before it is
trusted. This is not paranoia. During the launch-readiness round, deploy **v25** was silently
corrupted by a JSON over-escaping bug that wrote literal `\"` into 58 lines — every bare double
quote inside a template literal, including six stage prompts and the delivery email. It looked
fine. The byte comparison caught it; nothing else would have.

With the Supabase CLI this is much easier than it was through the MCP API — the CLI uploads from
disk, so the corruption class that produced v25 cannot occur. Still diff after deploying.

All eight functions run with `verify_jwt = false`. That is encoded per function in
`supabase/config.toml`, so a normal deploy preserves it; `--no-verify-jwt` is kept on the
documented commands as redundancy rather than as the only safeguard.
See DEPLOY.md.

## Architecture in one pass

Order → pg_cron ticks every minute → POSTs the `worker` function → `claim_next_stage()` claims
work with `FOR UPDATE SKIP LOCKED` (global cap 6, PARALLEL 3 per isolate) → stages run in sequence:

`analyze → org → voice → strategy → design → gen:* → validate → check → package → deliver`

Key mechanisms:

- **Evidence Ledger** — `E-INTAKE-n` (order form), `E-WEB-n` (crawled site), `E-PROP-n` (uploaded
  past proposals). Every fact about the applicant must trace to a ledger item.
- **Claim Ledger** — runs over the finished narrative and classifies every material claim:
  supported / qualified / model_proposed_future / stale / conflicting / donor_required_certification
  / unsupported. Material unsupported claims block delivery.
- **Website identity gate** (`orgNameMatchesSite`) — added v23/v24. Rejects a crawled site whose
  organisation does not match the applicant. Deliberately asymmetric: anything short of a confident
  match discards the site entirely. See reports/launch-readiness-report.md §E for why.
- **Exclusivity** — five partial unique indexes on `claims`, per grant: one per org, one concept
  tuple, one structural template, one opening device, one house voice. Enforced in
  `claim_approach()` (SECURITY DEFINER, sanctions gate, stale-hold expiry, unique_violation
  classification).
- **Reaper** — `reap_stale_stages()` kills stages with no heartbeat for 3 minutes. Every model call
  heartbeats (throttled to 20s, beats all stages in flight, since PARALLEL stages share an isolate).

## Current state — read the report before changing anything

`reports/launch-readiness-report.md` is the current assessment. Recommendation: **NOT_READY** for
paid launch. Summary of what is open:

**P0**
1. Blind evaluation by two model families rated pipeline output no better than a single well-crafted
   prompt to the same model. 8/8 judgements said "reads machine-generated". The most-repeated
   criticism was the **absence of proper nouns**, and the cause is now established: the intake
   collects identity only, so the evidence ledger is three items — organisation name, registration
   number, website URL (`worker/index.ts:1221-1223`). There is no ledger-backed source of place
   names, staff, partners, vendors or dated results, and grounding correctly forbids inventing
   them. This is data starvation, not a prompt fault. See "Decisions taken" below.
2. Hard ceiling of **8 proposals per grant**, and the effective ceiling is *lower and falling*.
   Proven by `tests/exclusivity/run.sh`: 40 applicants on one grant → 8 served, 32 refused,
   first refusal at applicant 9, `blocked_by=structural_template`. Two further findings:
   `release_claim()` works, is granted to `service_role`, and is called by nothing — so every
   order that reaches `strategy` and then dies burns a slot permanently; and
   `claims_house_voice_lock` indexes **zero rows**, because the worker hardcodes
   `voice_kind:"custom"`. Voice uniqueness is a ceiling on paper and is not enforced at all.
3. Competitive and Full tiers do not reliably complete — a single edge-function invocation cannot
   finish a large narrative that needs more than one generation attempt. One stage heartbeated for
   807s before being lost.
4. No failure notification at all. `sendEmail` appears once in the worker, in the deliver stage.

**P1**
5. Resetting a stage at or before `strategy` strands the order — the prior claim stays held and the
   retry is blocked by `existing_claim_same_org`. Release the claim by hand.
6. The crawler returns zero evidence on some real sites with no error (thefelixproject.org).
7. The deterministic consistency checker misses internal arithmetic errors that blind critics catch.
   It never sums anything and is one-directional (`n > target * 1.01`), so an understatement —
   exactly the delivered 200-vs-216 defect — passes by construction. `numbersNear()` is dead code.
   The design object is pasted into prompts as prose, so "single source of truth" is an instruction
   to a model, not a mechanism, and every section re-invents its own numbers.
8. No quality-drift monitoring — and validator-based monitoring would be blind to it, because every
   failing proposal passed every internal validator.

**P2**
9. Per-stage token accounting is a module-level global shared by concurrent stages, so recorded
   per-stage costs are cross-contaminated. Use OpenRouter's own accounting for cost work.
10. Currency defaults to USD regardless of the applicant's country.

## Decisions taken (2026-08-26)

On the root cause of proposal quality, the owner decided:

1. **Expand the intake form** into an automated evidence interview asked *before* payment, so the
   ledger can carry messy local nouns. Still fully automated — no human in the customer workflow.
2. **Crawl the applicant's own domain fully, including PDFs** (annual reports, accounts, trustee
   pages). **No third-party sources** — no news, no partner sites, no regulator filings — so the
   asymmetric identity gate stays meaningful.

The non-negotiables around those: no human in the loop; grounding holds and nothing is invented;
compliance holds; the Claim Ledger holds; exclusivity is unbounded and nobody ever waits; the
architecture and service list are fixed; and cost is measured per variant rather than assumed.

## Testing conventions

- `bench_cases` **no longer exists** — dropped 2026-08-23 with the 13 synthetic orders it
  indexed, to stop benchmark rows distorting production metrics. B1–B10 were archetypes;
  R1–R3 used real organisations with real websites. The four `test-org*` orders were removed
  in the same pass. **Production now contains only the two $1 trial orders** (KT-10001,
  KT-10002). Any future benchmark run needs its own manifest and must not create orders in
  the production project.
- The one live similarity-gate failure is preserved as a regression fixture at
  `tests/regression/similarity-gate/`, so that case survives without a fake order in
  production.
- `tests/replay/run.sh` replays all 11 migrations into a throwaway Postgres and asserts the schema
  fingerprint against production's recorded values, that no cron target references the production
  project, that nothing leaves the machine, and that no migration carries a literal secret.
  Run it after any migration change. Never edit `expected-fingerprint.txt` to make it pass.
- `tests/exclusivity/run.sh` is a **deliberately failing** test: it exits non-zero while any
  per-grant ceiling exists, and turns green only when one grant can serve any number of applicants.
- Quality is judged **blind** by a different model family from the generator — the generator never
  grades its own work. Evaluator sees only the grant text, the applicant identity, and the narrative.
- Language models cannot count words. Two critics wrongly claimed a 596-word document exceeded a
  600-word limit. Verify word counts deterministically, never from a model.

## Standing user-side items

- Deploy `render-service/` and set Vault secrets `render_service_url` and `render_service_secret`.
  Until then, any donor **page** limit blocks delivery (page count cannot be verified without a
  real render).
- Create Stripe payment links for Competitive and Full.
- Verify the Resend sending domain.
- Deactivate the $1 trial payment link before launch.
