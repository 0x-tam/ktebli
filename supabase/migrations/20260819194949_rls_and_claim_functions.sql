-- ============ RLS: deny by default, everywhere ============
alter table public.structural_templates enable row level security;
alter table public.opening_devices enable row level security;
alter table public.organisations enable row level security;
alter table public.voice_profiles enable row level security;
alter table public.grants enable row level security;
alter table public.grant_merge_reviews enable row level security;
alter table public.claims enable row level security;
alter table public.proposals enable row level security;
alter table public.intakes enable row level security;
alter table public.documents enable row level security;
alter table public.fingerprints enable row level security;
alter table public.similarity_reports enable row level security;
alter table public.escalations enable row level security;
alter table public.events enable row level security;

-- Belt and braces: strip default table grants from client roles on service-only tables.
revoke all on public.fingerprints, public.events, public.escalations,
              public.grant_merge_reviews, public.structural_templates,
              public.opening_devices from anon, authenticated;
-- Clients never write these directly; all writes go through the API server (service role).
revoke insert, update, delete on public.grants, public.claims, public.proposals,
              public.documents, public.similarity_reports, public.intakes,
              public.voice_profiles from anon, authenticated;
revoke all on public.organisations from anon;

-- helper: the caller's organisation
create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.organisations where owner_id = (select auth.uid());
$$;
revoke all on function public.my_org_id() from public, anon;
grant execute on function public.my_org_id() to authenticated;

-- organisations: see and manage only your own
create policy org_select on public.organisations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy org_insert on public.organisations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy org_update on public.organisations for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and sanctions_status = 'pending'); -- customers cannot self-clear screening

-- read-your-own for everything customer-visible
create policy vp_select on public.voice_profiles for select to authenticated
  using (organisation_id = public.my_org_id());
create policy claims_select on public.claims for select to authenticated
  using (organisation_id = public.my_org_id());
create policy proposals_select on public.proposals for select to authenticated
  using (organisation_id = public.my_org_id());
create policy intakes_select on public.intakes for select to authenticated
  using (proposal_id in (select id from public.proposals where organisation_id = public.my_org_id()));
create policy documents_select on public.documents for select to authenticated
  using (proposal_id in (select id from public.proposals where organisation_id = public.my_org_id()));
create policy simreports_select on public.similarity_reports for select to authenticated
  using (proposal_id in (select id from public.proposals where organisation_id = public.my_org_id()));

-- grants: visible only if your organisation has a claim on it
create policy grants_select on public.grants for select to authenticated
  using (id in (select grant_id from public.claims where organisation_id = public.my_org_id()));

-- ============ the claim machinery, atomic and audited ============

-- expire stale holds for one grant (called inside claim attempts and by cron)
create or replace function public.expire_stale_holds(p_grant uuid)
returns integer language sql security definer set search_path = '' as $$
  with expired as (
    update public.claims set status = 'released'
    where grant_id = p_grant and status = 'hold' and hold_expires_at < now()
    returning id
  ) select count(*)::integer from expired;
$$;
revoke all on function public.expire_stale_holds(uuid) from public, anon, authenticated;

-- attempt a claim: returns granted or the exact lock that blocked it
create or replace function public.claim_approach(
  p_org uuid, p_grant uuid,
  p_intervention text, p_delivery text, p_beneficiary text, p_geography text,
  p_mechanic text, p_template smallint, p_opening smallint,
  p_voice uuid, p_voice_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.claim_approach(uuid,uuid,text,text,text,text,text,smallint,smallint,uuid,text)
  from public, anon, authenticated;

-- confirm on payment: hold becomes durable
create or replace function public.confirm_claim(p_claim uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.confirm_claim(uuid) from public, anon, authenticated;

create or replace function public.release_claim(p_claim uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.claims set status = 'released' where id = p_claim and status in ('hold','confirmed');
  insert into public.events (actor, action, entity, entity_id, detail)
  values ('release_claim', 'claim_released', 'claim', p_claim::text, '{}'::jsonb);
  return found;
end;
$$;
revoke all on function public.release_claim(uuid) from public, anon, authenticated;

-- events are append-only even for service role sessions using the table directly
create or replace function public.events_no_change()
returns trigger language plpgsql as $$
begin
  raise exception 'events is append-only';
end;
$$;
create trigger events_immutable before update or delete on public.events
  for each row execute function public.events_no_change();

-- ============ private storage ============
insert into storage.buckets (id, name, public) values
  ('uploads', 'uploads', false),
  ('deliverables', 'deliverables', false)
on conflict (id) do nothing;

-- customers upload old proposals only into their own org folder
create policy uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads'
              and (storage.foldername(name))[1] = public.my_org_id()::text);
create policy uploads_select on storage.objects for select to authenticated
  using (bucket_id = 'uploads'
         and (storage.foldername(name))[1] = public.my_org_id()::text);
-- deliverables: read own, never write
create policy deliverables_select on storage.objects for select to authenticated
  using (bucket_id = 'deliverables'
         and (storage.foldername(name))[1] = public.my_org_id()::text);