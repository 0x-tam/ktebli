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
site/                  Vercel front end (index.html = landing + wizard, order.html = order page)
render-service/        docx render + page-count service (Dockerfile + server.mjs) — NOT YET DEPLOYED
reports/               engineering and launch-readiness reports
DEPLOY.md              CLI commands to deploy each function
BLUEPRINT.md           long-form product and architecture history
```

## Source-of-truth warning

`supabase/functions/worker/` was verified **byte-identical to deployed v26** (sha256 on both files).

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

All eight functions run with `verify_jwt = false`, so every deploy needs `--no-verify-jwt`.
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
   prompt to the same model. 8/8 judgements said "reads machine-generated".
2. Hard ceiling of **8 proposals per grant** (8 structural templates x 8 opening devices, both
   locked). The 9th customer pays, lands in `attention`, and is never emailed.
3. Competitive and Full tiers do not reliably complete — a single edge-function invocation cannot
   finish a large narrative that needs more than one generation attempt. One stage heartbeated for
   807s before being lost.
4. No failure notification at all. `sendEmail` appears once in the worker, in the deliver stage.

**P1**
5. Resetting a stage at or before `strategy` strands the order — the prior claim stays held and the
   retry is blocked by `existing_claim_same_org`. Release the claim by hand.
6. The crawler returns zero evidence on some real sites with no error (thefelixproject.org).
7. The deterministic consistency checker misses internal arithmetic errors that blind critics catch.
8. No quality-drift monitoring — and validator-based monitoring would be blind to it, because every
   failing proposal passed every internal validator.

**P2**
9. Per-stage token accounting is a module-level global shared by concurrent stages, so recorded
   per-stage costs are cross-contaminated. Use OpenRouter's own accounting for cost work.
10. Currency defaults to USD regardless of the applicant's country.

## Testing conventions

- `bench_cases` table holds benchmark cases (code, tier, org, guidelines, order_id, proposal_id).
  B1–B10 are archetypes; R1–R3 use real organisations with real websites.
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
