-- advisor fixes: pin search_path on the trigger function, move vector out of public
create or replace function public.events_no_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'events is append-only';
end;
$$;

create schema if not exists extensions;
alter extension vector set schema extensions;