-- =====================================================================
-- Ktebli — Supabase schema reference dump
-- Project ref: uocauqflcqefgdixbzpf
-- Generated: 2026-08-23
--
-- This is a READABLE REFERENCE, not a replayable migration. It is
-- assembled from catalog queries (information_schema / pg_catalog) and
-- contains no data rows.
--
-- SECRETS: no secret values are included. Secrets live in Supabase Vault
-- and are read through public.get_secret(text), which selects from
-- vault.decrypted_secrets. That schema is deliberately NOT dumped here.
-- Secret NAMES referenced by application code: openrouter_api_key,
-- openrouter_model, resend_api_key, email_from, stripe_webhook_secret,
-- site_url, support_email, worker_secret.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — TABLES AND COLUMNS (schema: public)
-- 25 base tables, 206 columns.
-- Format:  <column>  <type>  <nullability>  <default>
-- Note: "USER-DEFINED" types below are pgvector `vector` columns;
--       "ARRAY" columns are text[].
-- =====================================================================

-- table: bench_cases   (RLS DISABLED)
  code                         text                             NOT NULL 
  label                        text                             NULL     
  tier                         text                             NULL     
  org_name                     text                             NULL     
  org_reg                      text                             NULL     
  org_website                  text                             NULL     
  directions                   text                             NULL     
  guidelines                   text                             NULL     
  order_id                     uuid                             NULL     
  proposal_id                  uuid                             NULL     
  created_at                   timestamp with time zone         NULL     DEFAULT now()

-- table: claims   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  grant_id                     uuid                             NOT NULL 
  organisation_id              uuid                             NOT NULL 
  intervention_type            text                             NOT NULL 
  delivery_method              text                             NOT NULL 
  beneficiary                  text                             NOT NULL 
  geography_bucket             text                             NOT NULL 
  signature_mechanic           text                             NOT NULL 
  structural_template_id       smallint                         NOT NULL 
  opening_device_id            smallint                         NOT NULL 
  voice_profile_id             uuid                             NOT NULL 
  voice_kind                   text                             NOT NULL 
  status                       text                             NOT NULL DEFAULT 'hold'::text
  hold_expires_at              timestamp with time zone         NOT NULL DEFAULT (now() + '06:00:00'::interval)
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()
  strategy                     jsonb                            NULL     

-- table: documents   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  proposal_id                  uuid                             NOT NULL 
  kind                         text                             NOT NULL 
  storage_path                 text                             NOT NULL 
  sha256                       text                             NOT NULL 
  version                      smallint                         NOT NULL DEFAULT 1
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: escalations   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  proposal_id                  uuid                             NULL     
  kind                         text                             NOT NULL 
  detail                       jsonb                            NOT NULL DEFAULT '{}'::jsonb
  priority                     text                             NOT NULL DEFAULT 'normal'::text
  due_at                       timestamp with time zone         NOT NULL 
  status                       text                             NOT NULL DEFAULT 'open'::text
  resolved_at                  timestamp with time zone         NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: events   (RLS enabled) — append-only, see trigger events_immutable
  id                           bigint                           NOT NULL 
  actor                        text                             NOT NULL 
  action                       text                             NOT NULL 
  entity                       text                             NOT NULL 
  entity_id                    text                             NULL     
  detail                       jsonb                            NOT NULL DEFAULT '{}'::jsonb
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: fingerprints   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  grant_id                     uuid                             NOT NULL 
  organisation_id              uuid                             NULL     
  proposal_id                  uuid                             NULL     
  claim_snapshot               jsonb                            NOT NULL 
  narrative_embedding          USER-DEFINED (vector)            NULL     
  section_embeddings           jsonb                            NULL     
  embedding_version            text                             NOT NULL DEFAULT 'v1'::text
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: grant_merge_reviews   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  grant_a                      uuid                             NOT NULL 
  grant_b                      uuid                             NOT NULL 
  similarity                   numeric                          NOT NULL 
  status                       text                             NOT NULL DEFAULT 'pending'::text
  due_at                       timestamp with time zone         NOT NULL DEFAULT (now() + '04:00:00'::interval)
  resolved_at                  timestamp with time zone         NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: grants   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  funder                       text                             NOT NULL 
  title                        text                             NOT NULL 
  title_normalized             text                             NOT NULL 
  deadline                     date                             NULL     
  source_url                   text                             NULL     
  guidelines_text              text                             NOT NULL 
  guidelines_embedding         USER-DEFINED (vector)            NULL     
  embedding_version            text                             NOT NULL DEFAULT 'v1'::text
  status                       text                             NOT NULL DEFAULT 'open'::text
  merged_into                  uuid                             NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: intake_files   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  email                        text                             NOT NULL 
  file_name                    text                             NOT NULL 
  storage_path                 text                             NOT NULL 
  extracted_text               text                             NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: intakes   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  proposal_id                  uuid                             NOT NULL 
  answers                      jsonb                            NOT NULL DEFAULT '{}'::jsonb
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: job_stages   (RLS enabled)
  id                           bigint                           NOT NULL 
  proposal_id                  uuid                             NOT NULL 
  seq                          smallint                         NOT NULL 
  key                          text                             NOT NULL 
  label                        text                             NOT NULL 
  status                       text                             NOT NULL DEFAULT 'pending'::text
  attempt                      smallint                         NOT NULL DEFAULT 0
  max_attempts                 smallint                         NOT NULL DEFAULT 3
  started_at                   timestamp with time zone         NULL     
  finished_at                  timestamp with time zone         NULL     
  heartbeat_at                 timestamp with time zone         NULL     
  output                       jsonb                            NULL     
  error                        text                             NULL     

-- table: link_previews   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  url_or_text_hash             text                             NOT NULL 
  result                       jsonb                            NOT NULL 
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: opening_devices   (RLS enabled)
  id                           smallint                         NOT NULL 
  name                         text                             NOT NULL 
  description                  text                             NOT NULL 
  active                       boolean                          NOT NULL DEFAULT true

-- table: order_proposals   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  order_id                     uuid                             NOT NULL 
  grant_id                     uuid                             NULL     
  claim_id                     uuid                             NULL     
  title                        text                             NOT NULL DEFAULT 'Your proposal'::text
  status                       text                             NOT NULL DEFAULT 'queued'::text
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()
  revisions_used               smallint                         NOT NULL DEFAULT 0
  revisions_cap                smallint                         NOT NULL DEFAULT 1

-- table: orders   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  token                        uuid                             NOT NULL DEFAULT gen_random_uuid()
  stripe_session_id            text                             NULL     
  organisation_id              uuid                             NULL     
  email                        text                             NOT NULL 
  org_name                     text                             NOT NULL 
  whatsapp                     text                             NULL     
  tier                         text                             NOT NULL 
  amount_usd                   numeric                          NULL     
  grant_input                  text                             NOT NULL 
  deadline                     date                             NULL     
  directions                   text                             NULL     
  uploads_expected             smallint                         NOT NULL DEFAULT 0
  status                       text                             NOT NULL DEFAULT 'paid'::text
  tracking_email_sent          boolean                          NOT NULL DEFAULT false
  completion_email_sent        boolean                          NOT NULL DEFAULT false
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()
  order_no                     text                             NOT NULL DEFAULT ('KT-'::text || (nextval('order_no_seq'::regclass))::text)
  org_reg                      text                             NULL     
  org_website                  text                             NULL     

-- table: org_intel   (RLS enabled)
  organisation_id              uuid                             NOT NULL 
  domain                       text                             NULL     
  profile                      jsonb                            NOT NULL DEFAULT '{}'::jsonb
  evidence                     jsonb                            NOT NULL DEFAULT '[]'::jsonb
  voice                        jsonb                            NOT NULL DEFAULT '{}'::jsonb
  gaps                         jsonb                            NOT NULL DEFAULT '[]'::jsonb
  crawl                        jsonb                            NOT NULL DEFAULT '{}'::jsonb
  content_hash                 text                             NULL     
  crawled_at                   timestamp with time zone         NULL     
  updated_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: organisations   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  owner_id                     uuid                             NULL     
  name                         text                             NOT NULL 
  registration_number          text                             NOT NULL 
  email                        text                             NOT NULL 
  whatsapp                     text                             NULL     
  sanctions_status             text                             NOT NULL DEFAULT 'pending'::text
  sanctions_checked_at         timestamp with time zone         NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: pre_intakes   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  email                        text                             NOT NULL 
  org_name                     text                             NULL     
  grant_input                  text                             NULL     
  deadline                     date                             NULL     
  directions                   text                             NULL     
  upload_names                 ARRAY (text[])                   NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()
  org_reg                      text                             NULL     
  org_website                  text                             NULL     

-- table: proposals   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  organisation_id              uuid                             NOT NULL 
  grant_id                     uuid                             NOT NULL 
  claim_id                     uuid                             NOT NULL 
  tier                         text                             NOT NULL 
  price_usd                    numeric                          NOT NULL 
  payment_status               text                             NOT NULL DEFAULT 'unpaid'::text
  status                       text                             NOT NULL DEFAULT 'awaiting_payment'::text
  attempt_count                smallint                         NOT NULL DEFAULT 0
  revision_rounds_used         smallint                         NOT NULL DEFAULT 0
  revision_rounds_cap          smallint                         NOT NULL 
  delivered_at                 timestamp with time zone         NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: rate_limits   (RLS enabled)
  bucket                       text                             NOT NULL 
  window_start                 timestamp with time zone         NOT NULL 
  count                        integer                          NOT NULL DEFAULT 0

-- table: revision_requests   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  proposal_id                  uuid                             NOT NULL 
  options                      ARRAY (text[])                   NOT NULL DEFAULT '{}'::text[]
  details                      text                             NULL     
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: similarity_reports   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  proposal_id                  uuid                             NOT NULL 
  passed                       boolean                          NOT NULL 
  results                      jsonb                            NOT NULL 
  embedding_version            text                             NOT NULL 
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()

-- table: stripe_events   (RLS enabled) — webhook idempotency ledger
  id                           text                             NOT NULL 
  received_at                  timestamp with time zone         NOT NULL DEFAULT now()

-- table: structural_templates   (RLS enabled)
  id                           smallint                         NOT NULL 
  name                         text                             NOT NULL 
  description                  text                             NOT NULL 
  active                       boolean                          NOT NULL DEFAULT true

-- table: voice_profiles   (RLS enabled)
  id                           uuid                             NOT NULL DEFAULT gen_random_uuid()
  organisation_id              uuid                             NULL     
  kind                         text                             NOT NULL 
  profile                      jsonb                            NOT NULL 
  created_at                   timestamp with time zone         NOT NULL DEFAULT now()


-- =====================================================================
-- SECTION 2 — INDEXES (schema: public)
-- 46 indexes. Source: select indexdef from pg_indexes where schemaname='public'
-- =====================================================================

CREATE UNIQUE INDEX bench_cases_pkey ON public.bench_cases USING btree (code);
CREATE UNIQUE INDEX claims_concept_lock ON public.claims USING btree (grant_id, intervention_type, delivery_method, beneficiary, geography_bucket) WHERE (status = ANY (ARRAY['hold'::text, 'confirmed'::text]));
CREATE UNIQUE INDEX claims_house_voice_lock ON public.claims USING btree (grant_id, voice_profile_id) WHERE ((status = ANY (ARRAY['hold'::text, 'confirmed'::text])) AND (voice_kind = 'house'::text));
CREATE UNIQUE INDEX claims_one_per_org ON public.claims USING btree (grant_id, organisation_id) WHERE (status = ANY (ARRAY['hold'::text, 'confirmed'::text]));
CREATE UNIQUE INDEX claims_opening_lock ON public.claims USING btree (grant_id, opening_device_id) WHERE (status = ANY (ARRAY['hold'::text, 'confirmed'::text]));
CREATE UNIQUE INDEX claims_pkey ON public.claims USING btree (id);
CREATE UNIQUE INDEX claims_template_lock ON public.claims USING btree (grant_id, structural_template_id) WHERE (status = ANY (ARRAY['hold'::text, 'confirmed'::text]));
CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id);
CREATE UNIQUE INDEX escalations_pkey ON public.escalations USING btree (id);
CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);
CREATE INDEX fingerprints_grant_idx ON public.fingerprints USING btree (grant_id);
CREATE UNIQUE INDEX fingerprints_pkey ON public.fingerprints USING btree (id);
CREATE UNIQUE INDEX grant_merge_reviews_grant_a_grant_b_key ON public.grant_merge_reviews USING btree (grant_a, grant_b);
CREATE UNIQUE INDEX grant_merge_reviews_pkey ON public.grant_merge_reviews USING btree (id);
CREATE INDEX grants_dedupe_idx ON public.grants USING btree (funder, title_normalized, deadline);
CREATE UNIQUE INDEX grants_pkey ON public.grants USING btree (id);
CREATE INDEX intake_files_email_idx ON public.intake_files USING btree (email, created_at DESC);
CREATE UNIQUE INDEX intake_files_pkey ON public.intake_files USING btree (id);
CREATE UNIQUE INDEX intakes_pkey ON public.intakes USING btree (id);
CREATE UNIQUE INDEX intakes_proposal_id_key ON public.intakes USING btree (proposal_id);
CREATE UNIQUE INDEX job_stages_pkey ON public.job_stages USING btree (id);
CREATE UNIQUE INDEX job_stages_proposal_id_seq_key ON public.job_stages USING btree (proposal_id, seq);
CREATE INDEX job_stages_ready ON public.job_stages USING btree (status, seq) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
CREATE UNIQUE INDEX link_previews_pkey ON public.link_previews USING btree (id);
CREATE UNIQUE INDEX opening_devices_name_key ON public.opening_devices USING btree (name);
CREATE UNIQUE INDEX opening_devices_pkey ON public.opening_devices USING btree (id);
CREATE UNIQUE INDEX order_proposals_pkey ON public.order_proposals USING btree (id);
CREATE UNIQUE INDEX orders_order_no_idx ON public.orders USING btree (order_no);
CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id);
CREATE UNIQUE INDEX orders_stripe_session_id_key ON public.orders USING btree (stripe_session_id);
CREATE UNIQUE INDEX orders_token_key ON public.orders USING btree (token);
CREATE UNIQUE INDEX org_intel_pkey ON public.org_intel USING btree (organisation_id);
CREATE UNIQUE INDEX organisations_owner_id_key ON public.organisations USING btree (owner_id);
CREATE UNIQUE INDEX organisations_pkey ON public.organisations USING btree (id);
CREATE UNIQUE INDEX organisations_registration_number_key ON public.organisations USING btree (registration_number);
CREATE INDEX pre_intakes_email_idx ON public.pre_intakes USING btree (email, created_at DESC);
CREATE UNIQUE INDEX pre_intakes_pkey ON public.pre_intakes USING btree (id);
CREATE UNIQUE INDEX proposals_claim_id_key ON public.proposals USING btree (claim_id);
CREATE UNIQUE INDEX proposals_pkey ON public.proposals USING btree (id);
CREATE UNIQUE INDEX rate_limits_pkey ON public.rate_limits USING btree (bucket, window_start);
CREATE UNIQUE INDEX revision_requests_pkey ON public.revision_requests USING btree (id);
CREATE UNIQUE INDEX similarity_reports_pkey ON public.similarity_reports USING btree (id);
CREATE UNIQUE INDEX stripe_events_pkey ON public.stripe_events USING btree (id);
CREATE UNIQUE INDEX structural_templates_name_key ON public.structural_templates USING btree (name);
CREATE UNIQUE INDEX structural_templates_pkey ON public.structural_templates USING btree (id);
CREATE UNIQUE INDEX voice_profiles_pkey ON public.voice_profiles USING btree (id);


-- =====================================================================
-- SECTION 3 — FUNCTIONS (schema: public)
-- 13 routines. Source: pg_get_functiondef(p.oid) for prokind in ('f','p').
-- Bodies are complete and untruncated.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.claim_approach(p_org uuid, p_grant uuid, p_intervention text, p_delivery text, p_beneficiary text, p_geography text, p_mechanic text, p_template smallint, p_opening smallint, p_voice uuid, p_voice_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim uuid;
  v_blocked text;
begin
  -- refuse sanctioned or unscreened-flagged orgs at the door
  if exists (select 1 from public.organisations
             where id = p_org and sanctions_status in ('flagged','refused')) then
    return jsonb_build_object('granted', false, 'blocked_by', 'sanctions_screening');
  end if;

  perform public.expire_stale_holds(p_grant);

  begin
    insert into public.claims (grant_id, organisation_id, intervention_type, delivery_method,
      beneficiary, geography_bucket, signature_mechanic, structural_template_id,
      opening_device_id, voice_profile_id, voice_kind)
    values (p_grant, p_org, p_intervention, p_delivery, p_beneficiary, p_geography,
            p_mechanic, p_template, p_opening, p_voice, p_voice_kind)
    returning id into v_claim;
  exception when unique_violation then
    v_blocked := case
      when exists (select 1 from public.claims where grant_id = p_grant
        and organisation_id = p_org and status in ('hold','confirmed'))
        then 'existing_claim_same_org'
      when exists (select 1 from public.claims where grant_id = p_grant
        and intervention_type = p_intervention and delivery_method = p_delivery
        and beneficiary = p_beneficiary and geography_bucket = p_geography
        and status in ('hold','confirmed'))
        then 'concept_combination'
      when exists (select 1 from public.claims where grant_id = p_grant
        and structural_template_id = p_template and status in ('hold','confirmed'))
        then 'structural_template'
      when exists (select 1 from public.claims where grant_id = p_grant
        and opening_device_id = p_opening and status in ('hold','confirmed'))
        then 'opening_device'
      else 'house_voice'
    end;
    insert into public.events (actor, action, entity, entity_id, detail)
    values ('claim_approach', 'claim_blocked', 'grant', p_grant::text,
            jsonb_build_object('org', p_org, 'blocked_by', v_blocked));
    return jsonb_build_object('granted', false, 'blocked_by', v_blocked);
  end;

  insert into public.events (actor, action, entity, entity_id, detail)
  values ('claim_approach', 'claim_held', 'claim', v_claim::text,
          jsonb_build_object('org', p_org, 'grant', p_grant));
  return jsonb_build_object('granted', true, 'claim_id', v_claim);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_next_stage(p_global_cap integer DEFAULT 6)
 RETURNS TABLE(stage_id bigint, proposal_id uuid, seq smallint, key text, attempt smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- global concurrency cap across all proposals
  if (select count(*) from public.job_stages s
      where s.status = 'running'
        and s.heartbeat_at > now() - interval '3 minutes') >= p_global_cap then
    return;
  end if;

  return query
  with runnable as (
    select s.id
    from public.job_stages s
    where s.status = 'pending'
      and s.attempt < s.max_attempts
      and not exists (select 1 from public.job_stages p
                      where p.proposal_id = s.proposal_id and p.seq < s.seq
                        and p.status <> 'done')
      and not exists (select 1 from public.job_stages r
                      where r.proposal_id = s.proposal_id and r.status = 'running'
                        and r.heartbeat_at > now() - interval '3 minutes')
    order by s.proposal_id, s.seq
    limit 1
    for update skip locked
  )
  update public.job_stages s
     set status = 'running', attempt = s.attempt + 1,
         started_at = coalesce(s.started_at, now()), heartbeat_at = now(), error = null
    from runnable r where s.id = r.id
  returning s.id, s.proposal_id, s.seq, s.key, s.attempt;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_revision(p_proposal uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_used   smallint;
  v_cap    smallint;
  v_status text;
  v_new    smallint;
begin
  select status, revisions_used, revisions_cap
    into v_status, v_used, v_cap
    from public.order_proposals
    where id = p_proposal and order_id = p_order
    for update;                       -- row lock serialises concurrent callers

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status <> 'complete' then
    return jsonb_build_object('ok', false, 'reason', 'not_complete');
  end if;
  if v_used >= v_cap then
    return jsonb_build_object('ok', false, 'reason', 'no_revisions_left', 'remaining', 0);
  end if;

  update public.order_proposals
     set revisions_used = revisions_used + 1, status = 'processing'
     where id = p_proposal
     returning revisions_used into v_new;

  return jsonb_build_object('ok', true, 'revisions_used', v_new, 'remaining', v_cap - v_new);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_claim(p_claim uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ok boolean;
begin
  update public.claims set status = 'confirmed'
  where id = p_claim and status = 'hold' and hold_expires_at >= now();
  v_ok := found;
  insert into public.events (actor, action, entity, entity_id, detail)
  values ('confirm_claim', case when v_ok then 'claim_confirmed' else 'claim_confirm_failed' end,
          'claim', p_claim::text, '{}'::jsonb);
  return v_ok;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.events_no_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'events is append-only';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_holds(p_grant uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with expired as (
    update public.claims set status = 'released'
    where grant_id = p_grant and status = 'hold' and hold_expires_at < now()
    returning id
  ) select count(*)::integer from expired;
$function$
;

CREATE OR REPLACE FUNCTION public.get_secret(p_name text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.my_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id from public.organisations where owner_id = (select auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.reap_stale_stages()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with reaped as (
    update public.job_stages
       set status = case when attempt >= max_attempts then 'failed' else 'pending' end,
           error = coalesce(error,'') || ' [timeout]'
     where status = 'running' and heartbeat_at < now() - interval '3 minutes'
    returning id
  ) select count(*)::int from reaped;
$function$
;

CREATE OR REPLACE FUNCTION public.release_claim(p_claim uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.claims set status = 'released' where id = p_claim and status in ('hold','confirmed');
  insert into public.events (actor, action, entity, entity_id, detail)
  values ('release_claim', 'claim_released', 'claim', p_claim::text, '{}'::jsonb);
  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rl_hit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into public.rate_limits(bucket, window_start, count)
  values (p_key, w, 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into c;
  return c <= p_max;  -- true = allowed
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rollup_statuses()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update public.order_proposals p set status =
    case
      when not exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status <> 'done') then 'complete'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'failed') then 'attention'
      when exists (select 1 from public.job_stages s where s.proposal_id = p.id and s.status = 'held') then 'attention'
      else 'processing'
    end
  where exists (select 1 from public.job_stages s where s.proposal_id = p.id);

  update public.orders o set status =
    case
      when not exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status <> 'complete') then 'complete'
      when exists (select 1 from public.order_proposals p where p.order_id = o.id and p.status = 'attention') then 'attention'
      else 'processing'
    end
  where o.status in ('paid','processing','attention','complete')
    and exists (select 1 from public.order_proposals p where p.order_id = o.id);
$function$
;

CREATE OR REPLACE FUNCTION public.stripe_event_seen(p_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.stripe_events(id) values (p_id);
  return false;
exception when unique_violation then
  return true;
end;
$function$
;


-- =====================================================================
-- SECTION 4 — TRIGGERS (schema: public, tgisinternal = false)
-- 1 user trigger.
-- =====================================================================

CREATE TRIGGER events_immutable BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION events_no_change();


-- =====================================================================
-- SECTION 5 — ROW LEVEL SECURITY POLICIES (schema: public)
-- 10 policies, all PERMISSIVE and all for role `authenticated`.
-- Source: select * from pg_policies where schemaname='public'
-- Note: every policy is SELECT-only except the three on `organisations`.
-- There are NO policies granting anon/authenticated access to orders,
-- job_stages, order_proposals, pre_intakes, intake_files, etc. — those
-- tables are reached only through service-role edge functions.
-- =====================================================================

-- table: claims | policy: claims_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (organisation_id = my_org_id())
--   WITH CHECK: (none)
-- table: documents | policy: documents_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (proposal_id IN ( SELECT proposals.id
--    FROM proposals
--   WHERE (proposals.organisation_id = my_org_id())))
--   WITH CHECK: (none)
-- table: grants | policy: grants_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (id IN ( SELECT claims.grant_id
--    FROM claims
--   WHERE (claims.organisation_id = my_org_id())))
--   WITH CHECK: (none)
-- table: intakes | policy: intakes_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (proposal_id IN ( SELECT proposals.id
--    FROM proposals
--   WHERE (proposals.organisation_id = my_org_id())))
--   WITH CHECK: (none)
-- table: organisations | policy: org_insert | cmd: INSERT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (none)
--   WITH CHECK: (owner_id = ( SELECT auth.uid() AS uid))
-- table: organisations | policy: org_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (owner_id = ( SELECT auth.uid() AS uid))
--   WITH CHECK: (none)
-- table: organisations | policy: org_update | cmd: UPDATE | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (owner_id = ( SELECT auth.uid() AS uid))
--   WITH CHECK: ((owner_id = ( SELECT auth.uid() AS uid)) AND (sanctions_status = 'pending'::text))
-- table: proposals | policy: proposals_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (organisation_id = my_org_id())
--   WITH CHECK: (none)
-- table: similarity_reports | policy: simreports_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (proposal_id IN ( SELECT proposals.id
--    FROM proposals
--   WHERE (proposals.organisation_id = my_org_id())))
--   WITH CHECK: (none)
-- table: voice_profiles | policy: vp_select | cmd: SELECT | permissive: PERMISSIVE | roles: {authenticated}
--   USING: (organisation_id = my_org_id())
--   WITH CHECK: (none)


-- =====================================================================
-- SECTION 6 — RLS ENABLED FLAG PER TABLE (schema: public, relkind='r')
-- Source: pg_class.relrowsecurity
-- 24 of 25 tables have RLS enabled. bench_cases does NOT.
-- =====================================================================

-- bench_cases                  rls=f    <-- RLS NOT ENABLED
-- claims                       rls=t
-- documents                    rls=t
-- escalations                  rls=t
-- events                       rls=t
-- fingerprints                 rls=t
-- grant_merge_reviews          rls=t
-- grants                       rls=t
-- intake_files                 rls=t
-- intakes                      rls=t
-- job_stages                   rls=t
-- link_previews                rls=t
-- opening_devices              rls=t
-- order_proposals              rls=t
-- orders                       rls=t
-- org_intel                    rls=t
-- organisations                rls=t
-- pre_intakes                  rls=t
-- proposals                    rls=t
-- rate_limits                  rls=t
-- revision_requests            rls=t
-- similarity_reports           rls=t
-- stripe_events                rls=t
-- structural_templates         rls=t
-- voice_profiles               rls=t


-- =====================================================================
-- SECTION 7 — CRON JOBS (schema: cron)
-- The `cron` schema EXISTS (pg_cron installed). 1 job.
-- Source: select * from cron.job
-- =====================================================================

-- jobid 1 | jobname: ktebli-worker-tick | schedule: * * * * * | active: true
-- database: postgres | username: postgres
-- command:
--   select net.http_post(
--     url := 'https://uocauqflcqefgdixbzpf.supabase.co/functions/v1/worker',
--     headers := jsonb_build_object(
--       'Content-Type','application/json',
--       'x-worker-secret', public.get_secret('worker_secret')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 5000
--   );

-- (Secret value resolved at runtime by public.get_secret(); not stored here.)

-- =====================================================================
-- END OF DUMP
-- =====================================================================
