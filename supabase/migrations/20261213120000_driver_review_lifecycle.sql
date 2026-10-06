-- Driver review lifecycle.
-- Owner INSERT cannot choose approved/rejected/suspended/disabled.
-- Owner UPDATE still cannot change status, except rejected → pending
-- through resubmit_driver_application() (same auth user, same row).
-- Does not rewrite existing driver rows.

begin;

alter table public.driver_profiles
  add column if not exists driver_decision_note text;

comment on column public.driver_profiles.driver_decision_note is
  'Text the driver may see after a decision. Internal document notes stay on driver_documents.review_notes.';

create table if not exists public.driver_review_alerts (
  driver_user_id uuid not null,
  event_key text not null,
  created_at timestamptz not null default now(),
  primary key (driver_user_id, event_key)
);

comment on table public.driver_review_alerts is
  'Idempotency ledger for driver review emails and pushes. One event key sends at most once.';

alter table public.driver_review_alerts enable row level security;

revoke all on table public.driver_review_alerts from public;
revoke all on table public.driver_review_alerts from anon;
revoke all on table public.driver_review_alerts from authenticated;

-- Authenticated owners always start pending, even if the client sends another status.
create or replace function public.guard_driver_profiles_self_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  new.status := 'pending';
  new.is_online := false;
  new.driver_decision_note := null;
  return new;
end;
$$;

drop trigger if exists trg_a_guard_driver_profiles_self_insert on public.driver_profiles;
create trigger trg_a_guard_driver_profiles_self_insert
before insert on public.driver_profiles
for each row
execute function public.guard_driver_profiles_self_insert();

-- Runs before trg_driver_profiles_online_rules (name sorts first) so a forged
-- approved+online insert is pending+offline before the online check.

create or replace function public.guard_driver_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if auth.uid() is distinct from new.user_id then
    return new;
  end if;

  new.stripe_onboarded := old.stripe_onboarded;
  new.stripe_onboarded_at := old.stripe_onboarded_at;
  new.stripe_account_id := old.stripe_account_id;
  new.payout_enabled := old.payout_enabled;
  new.vehicle_verified := old.vehicle_verified;
  new.rating := old.rating;
  new.rating_count := old.rating_count;
  new.active_vehicle_id := old.active_vehicle_id;
  new.acceptance_rate := old.acceptance_rate;
  new.cancellation_rate := old.cancellation_rate;
  new.total_deliveries := old.total_deliveries;
  new.transport_mode := old.transport_mode;

  -- Rejected → pending only while resubmit_driver_application() set this flag
  -- in the same transaction. No other status change is possible for the owner.
  if current_setting('mmd.driver_resubmit', true) = '1'
     and old.status = 'rejected'
     and new.status = 'pending' then
    new.driver_decision_note := null;
    new.is_online := false;
  else
    new.status := old.status;
    new.driver_decision_note := old.driver_decision_note;
  end if;

  return new;
end;
$$;

create or replace function public.resubmit_driver_application()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_updated uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  perform set_config('mmd.driver_resubmit', '1', true);

  update public.driver_profiles
  set
    status = 'pending',
    driver_decision_note = null,
    is_online = false,
    updated_at = now()
  where user_id = v_uid
    and status = 'rejected'
  returning user_id into v_updated;

  if v_updated is null then
    return jsonb_build_object('ok', false, 'error', 'review_conflict');
  end if;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke all on function public.resubmit_driver_application() from public;
revoke all on function public.resubmit_driver_application() from anon;
grant execute on function public.resubmit_driver_application() to authenticated;
grant execute on function public.resubmit_driver_application() to service_role;

-- user_id is unique but not the primary key. Replica identity must include it
-- so the existing user_id filter receives UPDATE events without shipping every column.
do $$
declare
  idx name;
begin
  select i.relname into idx
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
  where n.nspname = 'public'
    and t.relname = 'driver_profiles'
    and x.indisunique
    and x.indnkeyatts = 1
    and a.attname = 'user_id'
    and not a.attisdropped
  limit 1;

  if idx is not null then
    execute format(
      'alter table public.driver_profiles replica identity using index %I',
      idx
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_profiles'
  ) then
    alter publication supabase_realtime add table public.driver_profiles;
  end if;
end $$;

commit;
