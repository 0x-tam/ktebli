-- Per-proposal spend tracking + a hard, code-enforced tier cap.
--
-- Every OpenRouter call this session was measured off the platform's OWN reported
-- cost (addUsage reads j.usage.cost — never re-derived from token counts, per
-- CLAUDE.md P2 #9). What was missing was a PERSISTENT running total per order and a
-- ceiling the worker actually refuses to cross. Without it, a bug that makes a stage
-- retry or a correction loop churn (exactly what happened during this project's own
-- phase-8 re-run: a design/validate loop burned budget past every planned line before
-- anyone was watching closely enough) has no code-level backstop — only operator
-- vigilance, which already failed once. This makes "never run down the whole
-- balance" a property of the code, not a promise.
--
-- spend_usd is monotonic (only ever incremented, via record_spend()) so it survives
-- stage retries and resets: a stage that fails and is reclaimed does not lose the
-- cost already spent on it. worker/index.ts checks it BEFORE starting a stage
-- (a free, no-model-call read) and again after every model call (an atomic
-- increment), so a capped proposal cannot spend past its ceiling by more than the
-- cost of the one call already in flight when the cap was crossed.
alter table public.order_proposals
  add column if not exists spend_usd numeric not null default 0,
  add column if not exists spend_capped_at timestamptz;

create or replace function public.record_spend(p_proposal_id uuid, p_amount numeric)
returns numeric
language sql
security definer
set search_path = ''
as $$
  update public.order_proposals
     set spend_usd = spend_usd + greatest(p_amount, 0)
   where id = p_proposal_id
  returning spend_usd;
$$;
revoke all on function public.record_spend(uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_spend(uuid, numeric) to service_role;

comment on column public.order_proposals.spend_usd is
  'Cumulative real OpenRouter cost for this proposal (all stages, all attempts, all model calls). Monotonic — never decremented, never reset by a stage retry. Checked against a per-tier cap (openrouter_spend_cap_draft/_competitive/_full secrets) before every stage starts.';
comment on column public.order_proposals.spend_capped_at is
  'Set the first time this proposal is refused further model work for exceeding its tier''s spend cap. NULL means never capped. A one-way marker: once capped, the order is a terminal spend_cap_reached hold (see worker/index.ts), not retried.';
