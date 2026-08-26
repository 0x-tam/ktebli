-- ============================================================================
-- The unbounded composer. Replaces two 8-row pools with a composed space.
--
-- WHY. structural_templates and opening_devices hold exactly 8 rows each, and
-- claims_template_lock / claims_opening_lock make each row exclusive per grant.
-- That IS the ceiling: tests/exclusivity/run.sh walks 40 applicants onto one
-- grant and serves 8. The 9th pays and is never emailed.
--
-- Adding rows would not have fixed it. The worker's loop bound is a code
-- constant (index.ts, `tpl <= 8`), so a 9th row would be ignored -- and even if
-- it were read, the two integers reach the document through a single 40-word
-- line in a 4,000-token prompt, while every instruction that actually shapes the
-- prose is byte-identical on every proposal Ktebli has ever produced. The
-- ceiling of 8 and "reads machine-generated" are one defect seen from two ends.
--
-- So: a pool becomes a vocabulary, and the lock moves from a row id to a
-- fingerprint of a composition drawn across twelve independent axes.
-- ============================================================================

-- ---------------------------------------------------------------- 1. vocabulary
-- A pool is CONSUMED by a claim and gone. A vocabulary is READ to build a prompt
-- and is never consumed, so adding a row widens the space, removing one narrows
-- it, and neither can exhaust.
create table if not exists public.composition_axes (
  axis text not null,
  code text not null,
  label text not null,
  description text not null,
  prompt_directive text not null,
  requires_evidence boolean not null default false,
  active boolean not null default true,
  primary key (axis, code)
);
alter table public.composition_axes enable row level security;
revoke all on public.composition_axes from anon, authenticated;
grant select on public.composition_axes to service_role;

-- The 16 seeded pool rows are carried forward rather than discarded. They were
-- good values; they were simply being used as a pool instead of as a vocabulary.
insert into public.composition_axes (axis, code, label, description, prompt_directive)
select 'spine', t.name, t.name, t.description, t.description
  from public.structural_templates t
on conflict do nothing;

insert into public.composition_axes (axis, code, label, description, prompt_directive, requires_evidence)
select 'opening_move', d.name, d.name, d.description, d.description,
       d.name in ('incident','voice')
  from public.opening_devices d
on conflict do nothing;

-- Group A -- SHAPE: what the argument is organised by.
insert into public.composition_axes (axis, code, label, description, prompt_directive) values
 ('spine','causal_chain','causal chain','Each section is one link from cause to effect',
  'Organise the document as a chain: each section takes the previous one''s conclusion as its premise. The reader should never have to hold two threads at once.'),
 ('spine','beneficiary_journey','beneficiary journey','Follows one participant''s path through the service',
  'Organise around the path a participant takes, from first contact to exit. Each section is a stage of that path, with its own needs, activities and evidence.'),
 ('spine','decision_points','decision points','A sequence of choices made and defended',
  'Organise as a sequence of decisions: at each point state the choice that was open, the one taken, and why. The reader should finish knowing the project was designed, not assembled.'),
 ('spine','risk_and_answer','risk and answer','Each section raises the hardest objection and answers it',
  'Organise around the objections a sceptical reviewer would raise. Each section states one plainly, then answers it with evidence.'),
 ('spine','cost_of_inaction','cost of inaction','Built on what continues if this is not funded',
  'Organise around what happens if nothing changes. Each section establishes a cost of inaction, then the part of the response that removes it.'),
 ('argument_carrier','evidence','evidence carries','Evidence persuades; mechanism supports',
  'Let evidence do the persuading. Lead sections with what is known and let the mechanism follow in support.'),
 ('argument_carrier','mechanism','mechanism carries','How it works persuades',
  'Let the mechanism do the persuading: the reader should be convinced because they understand exactly how the thing works.'),
 ('argument_carrier','sequence','sequence carries','Order of operations persuades',
  'Let sequence do the persuading: the reader is convinced because each step visibly makes the next possible.'),
 ('argument_carrier','actors','actors carry','Who does what persuades',
  'Let the actors do the persuading: name who does what, and let capability follow from the naming.'),
 ('argument_carrier','economics','economics carry','Cost per outcome persuades',
  'Let the economics do the persuading. Spend words on cost per outcome and compress the mechanism to a sentence where you can.'),
 ('argument_carrier','counterfactual','counterfactual carries','The alternative persuades',
  'Let the counterfactual do the persuading: keep returning to what happens if this is not funded.')
on conflict do nothing;

-- Group B -- REGISTER: sentence-level texture. v26 controls this with nothing at
-- all, which is why every proposal defaults to the generator's house register --
-- precisely what the blind evaluators recognised.
insert into public.composition_axes (axis, code, label, description, prompt_directive) values
 ('paragraph_regime','short_dense','short dense','Short paragraphs, high information density',
  'Keep paragraphs to two or three sentences, each carrying new information. No throat-clearing.'),
 ('paragraph_regime','long_developed','long developed','Few paragraphs, each fully developed',
  'Write few paragraphs and develop each one properly: a claim, its support, and its consequence before moving on.'),
 ('paragraph_regime','alternating','alternating','Alternates short and long deliberately',
  'Alternate deliberately between short paragraphs that land a point and longer ones that develop it.'),
 ('paragraph_regime','lead_and_expand','lead and expand','A one-line lead, then expansion',
  'Open each section with a single-sentence paragraph that states the point, then expand it in the paragraphs that follow.'),
 ('paragraph_regime','staccato_then_block','staccato then block','Short bursts, then a settled block',
  'Open sections in short bursts and settle into a longer block once the ground is established.'),
 ('stance','institutional_third','institutional third person','The organisation will...',
  'Write in the institutional third person throughout: the organisation is the grammatical subject.'),
 ('stance','first_plural_committal','first person plural, committal','We will...',
  'Write in the first person plural and make it committal: we will, we have, we expect. Own every claim.'),
 ('stance','first_plural_reflective','first person plural, reflective','We have found that...',
  'Write in the first person plural, reflectively: what we have learned, what surprised us, what we would do differently.'),
 ('stance','impersonal_project','impersonal','Four centres will open...',
  'Write impersonally, with the work itself as the grammatical subject. Avoid both the organisation and we.'),
 ('stance','beneficiary_centred','beneficiary centred','Participants will find...',
  'Make the people served the grammatical subject wherever the sentence allows it.'),
 ('stance','evaluator_addressed','evaluator addressed','You will see that...',
  'Address the reviewer directly where it helps them assess: say what they will find, and where.'),
 ('evidence_integration','inline_parenthetical','inline parenthetical','Evidence in parentheses after the claim',
  'Carry evidence inline, in parentheses, immediately after the claim it supports.'),
 ('evidence_integration','sentence_subject','evidence as subject','The evidence is the subject of the sentence',
  'Make the evidence the subject of its sentence rather than a citation attached to someone else''s.'),
 ('evidence_integration','after_claim','evidence after claim','Claim first, evidence in the next sentence',
  'State the claim, then give the evidence in the sentence that follows. Never in the same breath.'),
 ('evidence_integration','tabulated_then_referenced','tabulated then referenced','Gathered in a table, referenced in prose',
  'Gather the evidence into one table and reference it from the prose rather than restating it.'),
 ('evidence_integration','narrative_scale','narrative scale','Evidence told as change over time',
  'Present evidence as movement over time -- what it was, what it is -- rather than as static figures.')
on conflict do nothing;

-- Group C -- DEVICE: local, once per document, high salience.
-- The first eighty words are what a reviewer forms an impression from, and
-- nothing in v26 says how a proposal should END, so every proposal ends the way
-- the generator ends things.
insert into public.composition_axes (axis, code, label, description, prompt_directive, requires_evidence) values
 ('opening_move','mechanism_first','mechanism first','Opens on how the thing works',
  'Open on the mechanism: the first sentences explain how the response works, before why it is needed.', false),
 ('opening_move','cost_of_delay','cost of delay','Opens on what another year costs',
  'Open on what another year of the status quo costs, concretely.', false),
 ('opening_move','definition','definition','Opens by defining the thing precisely',
  'Open by defining precisely what is being proposed, in one exact sentence, before anything else.', false),
 ('opening_move','scale_shift','scale shift','Opens wide, narrows hard to one place',
  'Open at national or regional scale and narrow within three sentences to one specific place.', false),
 ('opening_move','commitment','commitment','Opens on what the organisation is committing',
  'Open on what the applicant is putting in -- staff, premises, money, years -- before what it is asking for.', false),
 ('opening_move','donor_priority_echo','donor priority echo','Opens on the donor''s own stated priority',
  'Open by taking the donor''s own stated priority and showing what it looks like on the ground here.', false),
 ('closing_move','sustainability_mechanism','sustainability mechanism','Ends on what continues and who pays',
  'End on the mechanism that keeps this running: what continues, who owns it, what it costs, who pays.', false),
 ('closing_move','what_changes_by_date','what changes by date','Ends on the state of the world on a date',
  'End by describing the state of the world on a named date, as if reporting back.', false),
 ('closing_move','ask_restated','ask restated','Ends by restating the ask exactly',
  'End by restating the ask exactly: the amount, the period, and what it buys.', false),
 ('closing_move','risk_answered','risk answered','Ends on the biggest risk and its answer',
  'End on the largest remaining risk and the specific answer to it. Do not end on reassurance.', false),
 ('closing_move','partner_commitment','partner commitment','Ends on what partners have committed',
  'End on what named partners have committed to, and what that commitment is worth.', false),
 ('closing_move','next_grant_horizon','next grant horizon','Ends on what comes after this grant',
  'End on what this makes possible next, and what the applicant intends to do about it.', false),
 ('closing_move','beneficiary_endstate','beneficiary endstate','Ends with one participant, after',
  'End with one participant''s situation after the project, grounded in the ledger.', true),
 ('closing_move','institutional_continuity','institutional continuity','Ends on the organisation''s own arc',
  'End on where this sits in the organisation''s own arc: what it was built on, what it builds toward.', false),
 ('tabular_policy','minimal','minimal','Prose only, tables only where mandated',
  'Use prose. Introduce a table only where the donor requires one.', false),
 ('tabular_policy','targets_only','targets only','One table, for targets',
  'Use exactly one table, for targets and indicators. Everything else is prose.', false),
 ('tabular_policy','targets_and_timeline','targets and timeline','Two tables',
  'Use two tables: one for targets, one for the timeline. Everything else is prose.', false),
 ('tabular_policy','structured_throughout','structured throughout','Tables wherever information is tabular',
  'Use a table wherever the information is genuinely tabular, and keep the prose between them short.', false)
on conflict do nothing;

-- ---------------------------------------------------------------- 2. the claim
alter table public.claims add column if not exists fingerprint text;
alter table public.claims add column if not exists axes jsonb;
alter table public.claims add column if not exists composition jsonb;
alter table public.claims add column if not exists composer_resolution smallint not null default 1;

comment on column public.claims.fingerprint is
  'sha256 hex of the canonical composed AXES (codes and integers only). Never a hash of free text: two compositions differing only in wording produce the same digest and the second is rejected. The realisation prose lives in composition and is not hashed.';
comment on column public.claims.axes is
  'The canonical tuple that was hashed, stored verbatim so the digest is reproducible from the row.';

-- Backfill. A pre-composer claim has no composition, so giving it a composed
-- fingerprint would be a lie the distinctness metric would then act on. Sentinel
-- values occupy the index without ever colliding with a composed digest.
update public.claims set fingerprint = 'legacy-v26:' || id::text where fingerprint is null;
alter table public.claims alter column fingerprint set not null;

-- ---------------------------------------------------------------- 3. the locks
-- LOCK 3 and LOCK 4 ARE the ceiling of 8.
drop index if exists public.claims_template_lock;
drop index if exists public.claims_opening_lock;

-- LOCK 5 has never matched a row and never could: voice_kind is hardcoded
-- 'custom' in the worker and nothing seeds a house voice. Its only live effect
-- was mislabelling unexplained unique violations through the else-branch of
-- claim_approach's classifier.
drop index if exists public.claims_house_voice_lock;

-- LOCK 2 is demoted from a hard lock to a soft signal. Two nonprofits can
-- legitimately propose the same intervention for the same beneficiaries in the
-- same district on a grant that funds exactly that; forcing 40 applicants onto
-- 40 distinct concept tuples is uniqueness bought with quality. The requirement
-- is that no two proposals share a writing style, a shape or a form -- not that
-- no two share a project concept. The tuple is still recorded and still shown to
-- the strategist.
drop index if exists public.claims_concept_lock;
create index if not exists claims_concept_idx
  on public.claims (grant_id, intervention_type, delivery_method)
  where status in ('hold','confirmed');

-- LOCK 1 is kept unchanged: one live claim per organisation per grant is not a
-- ceiling across customers.

-- THE NEW ARBITER.
create unique index claims_fingerprint_lock
  on public.claims (grant_id, fingerprint)
  where status in ('hold','confirmed');

-- expire_stale_holds and the taken-set read both scan by grant. At 8 claims per
-- grant that never mattered; at 10,000 it does.
create index if not exists claims_grant_live_idx
  on public.claims (grant_id)
  where status in ('hold','confirmed');

-- ---------------------------------------------------------------- 4. the FKs
-- The columns are dropped, not merely nulled: leaving them would leave two
-- integers that look authoritative and are not, and the next reader would wire
-- something to them. The tables themselves are kept as the provenance of the
-- migrated vocabulary.
alter table public.claims drop column if exists structural_template_id;
alter table public.claims drop column if exists opening_device_id;
comment on table public.structural_templates is
  'DEPRECATED. Source of the migrated spine vocabulary in composition_axes. Read by nothing. Was a consumable pool of 8; that pool WAS the exclusivity ceiling.';
comment on table public.opening_devices is
  'DEPRECATED. Source of the migrated opening_move vocabulary in composition_axes.';

-- ---------------------------------------------------------------- 5. the function
-- The old signature is dropped explicitly, or Postgres keeps both overloads and
-- PostgREST resolves by argument names -- an ambiguity that would silently route
-- some calls to the ceiling-bound version.
drop function if exists public.claim_approach(
  uuid, uuid, text, text, text, text, text, smallint, smallint, uuid, text);

create or replace function public.claim_approach(
  p_org uuid, p_grant uuid,
  p_intervention text, p_delivery text, p_beneficiary text, p_geography text,
  p_mechanic text,
  p_fingerprint text, p_axes jsonb, p_composition jsonb,
  p_resolution smallint default 1,
  p_voice uuid default null, p_voice_kind text default 'custom'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_claim uuid;
  v_blocked text;
begin
  if exists (select 1 from public.organisations
             where id = p_org and sanctions_status in ('flagged','refused')) then
    return jsonb_build_object('granted', false, 'blocked_by', 'sanctions_screening');
  end if;

  if p_fingerprint is null or length(p_fingerprint) < 16 then
    return jsonb_build_object('granted', false, 'blocked_by', 'malformed_fingerprint');
  end if;

  perform public.expire_stale_holds(p_grant);

  -- The whole transaction is this INSERT. No model call, no HTTP call and no
  -- sleep is inside it, which is why two callers racing the same fingerprint
  -- block each other for about a millisecond rather than for a generation.
  begin
    insert into public.claims (grant_id, organisation_id, intervention_type, delivery_method,
      beneficiary, geography_bucket, signature_mechanic,
      fingerprint, axes, composition, composer_resolution, voice_profile_id, voice_kind)
    values (p_grant, p_org, p_intervention, p_delivery, p_beneficiary, p_geography,
            p_mechanic, p_fingerprint, p_axes, p_composition,
            coalesce(p_resolution, 1), p_voice, coalesce(p_voice_kind, 'custom'))
    returning id into v_claim;
  exception when unique_violation then
    -- Two live locks remain, so the classifier has two real cases and an honest
    -- catch-all. The old else-branch reported 'house_voice' -- a lock that could
    -- never fire -- for every unexplained violation. Never guess a blocker.
    v_blocked := case
      when exists (select 1 from public.claims
                    where grant_id = p_grant and organisation_id = p_org
                      and status in ('hold','confirmed'))
        then 'existing_claim_same_org'
      when exists (select 1 from public.claims
                    where grant_id = p_grant and fingerprint = p_fingerprint
                      and status in ('hold','confirmed'))
        then 'fingerprint_taken'
      else 'unknown_unique_violation'
    end;
    -- fingerprint_taken is the ordinary, expected outcome of a race, and the
    -- worker re-rolls on it. Logging one event per collision would flood a table
    -- that is append-only by trigger, so only abnormal cases are recorded.
    if v_blocked <> 'fingerprint_taken' then
      insert into public.events (actor, action, entity, entity_id, detail)
      values ('claim_approach', 'claim_blocked', 'grant', p_grant::text,
              jsonb_build_object('org', p_org, 'blocked_by', v_blocked));
    end if;
    return jsonb_build_object('granted', false, 'blocked_by', v_blocked);
  end;

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('claim_approach', 'claim_held', 'claim', v_claim::text,
          jsonb_build_object('org', p_org, 'grant', p_grant,
                             'fingerprint', p_fingerprint, 'resolution', p_resolution));
  return jsonb_build_object('granted', true, 'claim_id', v_claim);
end;
$$;

revoke all on function public.claim_approach(
  uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,smallint,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_approach(
  uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,smallint,uuid,text) to service_role;
