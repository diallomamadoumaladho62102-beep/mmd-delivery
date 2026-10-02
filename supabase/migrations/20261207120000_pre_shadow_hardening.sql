-- Pre-SHADOW hardening: marketplace integrity, multi-assignment trip time,
-- wait/dispute uniqueness, voice contact columns. Flags stay OFF. No backfill.

-- ---------------------------------------------------------------------------
-- Allow marketplace_job on integrity tables (keep old rows)
-- ---------------------------------------------------------------------------
alter table public.driver_integrity_incidents
  drop constraint if exists driver_integrity_incidents_entity_type_check;
alter table public.driver_integrity_incidents
  add constraint driver_integrity_incidents_entity_type_check
  check (entity_type in ('order', 'delivery_request', 'marketplace_job'));

alter table public.driver_wait_reasons
  drop constraint if exists driver_wait_reasons_entity_type_check;
alter table public.driver_wait_reasons
  add constraint driver_wait_reasons_entity_type_check
  check (entity_type in ('order', 'delivery_request', 'marketplace_job'));

alter table public.driver_trip_disputes
  drop constraint if exists driver_trip_disputes_entity_type_check;
alter table public.driver_trip_disputes
  add constraint driver_trip_disputes_entity_type_check
  check (entity_type in ('order', 'delivery_request', 'marketplace_job'));

alter table public.driver_trip_disputes
  drop constraint if exists driver_trip_disputes_reason_code_check;
alter table public.driver_trip_disputes
  add constraint driver_trip_disputes_reason_code_check
  check (reason_code in (
    'restaurant_delay', 'order_issue', 'traffic', 'gps_issue',
    'technical_issue', 'vehicle_issue', 'safety_issue', 'other',
    'restaurant', 'wait', 'gps', 'technical'
  ));

create unique index if not exists driver_wait_reasons_uniq
  on public.driver_wait_reasons (entity_type, entity_id, driver_id, reason_code);

create unique index if not exists driver_trip_disputes_driver_entity_uniq
  on public.driver_trip_disputes (entity_type, entity_id, driver_id);

-- Marketplace reassignment exclusion (prevents the previous driver from
-- self-accepting the same job after unassign).
create table if not exists public.driver_integrity_reassignment_exclusions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('order', 'delivery_request', 'marketplace_job')),
  entity_id uuid not null,
  driver_id uuid not null,
  incident_id uuid references public.driver_integrity_incidents (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, driver_id)
);

create index if not exists driver_integrity_reassignment_exclusions_job_idx
  on public.driver_integrity_reassignment_exclusions (entity_type, entity_id);

alter table public.driver_integrity_reassignment_exclusions enable row level security;

drop policy if exists driver_integrity_exclusions_staff_read
  on public.driver_integrity_reassignment_exclusions;
create policy driver_integrity_exclusions_staff_read
  on public.driver_integrity_reassignment_exclusions for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

grant select on public.driver_integrity_reassignment_exclusions to authenticated;

-- Voice contact metadata (never store driver phone here)
alter table public.driver_integrity_contacts
  add column if not exists call_session_id uuid;
alter table public.driver_integrity_contacts
  add column if not exists result text;
alter table public.driver_integrity_contacts
  add column if not exists entity_type text;
alter table public.driver_integrity_contacts
  add column if not exists entity_id uuid;

-- ---------------------------------------------------------------------------
-- trip_time_intervals: one row per assignment attempt, not per entity
-- ---------------------------------------------------------------------------
alter table public.trip_time_intervals
  add column if not exists assignment_seq integer not null default 1;

alter table public.trip_time_intervals
  drop constraint if exists trip_time_intervals_entity_uq;

alter table public.trip_time_intervals
  drop constraint if exists trip_time_intervals_range_chk;

alter table public.trip_time_intervals
  drop constraint if exists trip_time_intervals_end_reason_check;

-- Recreate end_reason to include reassigned (column check may be inline)
do $$
begin
  alter table public.trip_time_intervals
    drop constraint if exists trip_time_intervals_end_reason_check;
exception
  when undefined_object then null;
end $$;

alter table public.trip_time_intervals
  add constraint trip_time_intervals_end_reason_check
  check (end_reason is null or end_reason in (
    'completed', 'cancelled', 'admin_cancelled', 'inferred', 'reassigned'
  ));

alter table public.trip_time_intervals
  add constraint trip_time_intervals_range_chk
  check (ended_at is null or ended_at >= started_at);

alter table public.trip_time_intervals
  add constraint trip_time_intervals_attempt_uq
  unique (entity_type, entity_id, assignment_seq);

create unique index if not exists trip_time_intervals_open_entity_uq
  on public.trip_time_intervals (entity_type, entity_id)
  where ended_at is null;

create index if not exists trip_time_intervals_entity_seq_idx
  on public.trip_time_intervals (entity_type, entity_id, assignment_seq);

comment on column public.trip_time_intervals.assignment_seq is
  '1-based assignment attempt. First driver is seq 1. Reassignment inserts seq N+1. started_at is never rewritten.';

-- Close the open interval for an entity without touching started_at/driver_id.
create or replace function public.minimum_pay_close_open_trip_interval(
  p_entity_type text,
  p_entity_id uuid,
  p_end_reason text,
  p_ended_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.minimum_pay_engine_is_recording() then
    return;
  end if;
  update public.trip_time_intervals
  set
    ended_at = coalesce(ended_at, p_ended_at),
    end_reason = coalesce(end_reason, p_end_reason),
    updated_at = now()
  where entity_type = p_entity_type
    and entity_id = p_entity_id
    and ended_at is null;
end;
$$;

create or replace function public.minimum_pay_sync_trip_interval(
  p_entity_type text,
  p_entity_id uuid,
  p_driver_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_end_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_open public.trip_time_intervals%rowtype;
  v_next integer;
begin
  if p_driver_id is null or p_started_at is null then
    return;
  end if;
  if not public.minimum_pay_engine_is_recording() then
    return;
  end if;
  if exists (
    select 1
    from public.minimum_pay_engine_settings s
    where s.singleton = true
      and s.engine_start_at is not null
      and p_started_at < s.engine_start_at
  ) then
    return;
  end if;

  select *
    into v_open
  from public.trip_time_intervals
  where entity_type = p_entity_type
    and entity_id = p_entity_id
    and ended_at is null
  order by assignment_seq desc
  limit 1;

  if found and v_open.driver_id = p_driver_id then
    update public.trip_time_intervals
    set
      ended_at = coalesce(trip_time_intervals.ended_at, p_ended_at),
      end_reason = coalesce(trip_time_intervals.end_reason, p_end_reason),
      updated_at = now()
    where id = v_open.id;
    return;
  end if;

  if found and v_open.driver_id is distinct from p_driver_id then
    update public.trip_time_intervals
    set
      ended_at = coalesce(ended_at, coalesce(p_ended_at, now())),
      end_reason = coalesce(end_reason, 'reassigned'),
      updated_at = now()
    where id = v_open.id;
  end if;

  select coalesce(max(assignment_seq), 0) + 1
    into v_next
  from public.trip_time_intervals
  where entity_type = p_entity_type
    and entity_id = p_entity_id;

  insert into public.trip_time_intervals (
    driver_id, entity_type, entity_id, assignment_seq,
    started_at, ended_at, end_reason, start_source
  )
  values (
    p_driver_id, p_entity_type, p_entity_id, v_next,
    p_started_at, p_ended_at, p_end_reason, 'offer_accept'
  );
end;
$$;

-- Close intervals when a driver is unassigned (reassignment). Do not rewrite history.
create or replace function public.minimum_pay_close_order_trip_on_unassign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.driver_id is not null and new.driver_id is null then
    perform public.minimum_pay_close_open_trip_interval(
      'order', new.id, 'reassigned', now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_close_order_trip_on_unassign on public.orders;
create trigger trg_minimum_pay_close_order_trip_on_unassign
  after update of driver_id on public.orders
  for each row
  execute function public.minimum_pay_close_order_trip_on_unassign();

create or replace function public.minimum_pay_close_dr_trip_on_unassign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.driver_id is not null and new.driver_id is null then
    perform public.minimum_pay_close_open_trip_interval(
      'delivery_request', new.id, 'reassigned', now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_close_dr_trip_on_unassign on public.delivery_requests;
create trigger trg_minimum_pay_close_dr_trip_on_unassign
  after update of driver_id on public.delivery_requests
  for each row
  execute function public.minimum_pay_close_dr_trip_on_unassign();

create or replace function public.minimum_pay_close_mkt_trip_on_unassign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.assigned_driver_id is not null and new.assigned_driver_id is null then
    perform public.minimum_pay_close_open_trip_interval(
      'marketplace_job', new.id, 'reassigned', now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_close_mkt_trip_on_unassign
  on public.marketplace_delivery_jobs;
create trigger trg_minimum_pay_close_mkt_trip_on_unassign
  after update of assigned_driver_id on public.marketplace_delivery_jobs
  for each row
  execute function public.minimum_pay_close_mkt_trip_on_unassign();

-- ---------------------------------------------------------------------------
-- Marketplace reassignment RPC (service_role only, fail-closed)
-- ---------------------------------------------------------------------------
create or replace function public.driver_integrity_reassign_marketplace_job(
  p_job_id uuid,
  p_expected_driver_id uuid,
  p_incident_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.driver_integrity_settings%rowtype;
  v_job public.marketplace_delivery_jobs%rowtype;
  v_incident public.driver_integrity_incidents%rowtype;
begin
  select * into v_settings from public.driver_integrity_settings where singleton = true;
  if v_settings.monitoring_enabled is not true
     or v_settings.reassignment_enabled is not true then
    return jsonb_build_object('ok', false, 'message', 'flags_off');
  end if;

  select * into v_incident
  from public.driver_integrity_incidents
  where id = p_incident_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'incident_not_found');
  end if;

  if v_incident.reassigned_at is not null then
    return jsonb_build_object('ok', true, 'message', 'already_reassigned', 'idempotent', true);
  end if;

  select * into v_job
  from public.marketplace_delivery_jobs
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'job_not_found');
  end if;
  if v_job.assigned_driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('ok', false, 'message', 'driver_mismatch');
  end if;
  if lower(coalesce(v_job.status, '')) <> 'dispatch_assigned' then
    return jsonb_build_object('ok', false, 'message', 'not_assigned_state');
  end if;

  update public.marketplace_delivery_jobs
  set
    assigned_driver_id = null,
    status = 'dispatch_ready',
    updated_at = now()
  where id = p_job_id;
  -- driver_accepted_at is intentionally left intact.

  insert into public.driver_integrity_reassignment_exclusions (
    entity_type, entity_id, driver_id, incident_id
  )
  values ('marketplace_job', p_job_id, p_expected_driver_id, p_incident_id)
  on conflict (entity_type, entity_id, driver_id) do nothing;

  update public.driver_integrity_incidents
  set
    status = 'reassigned',
    reassigned_at = now(),
    reassigned_by = 'system',
    updated_at = now()
  where id = p_incident_id;

  insert into public.driver_integrity_events (incident_id, event_type, payload)
  values (
    p_incident_id,
    'DRIVER_ORDER_REASSIGNED',
    jsonb_build_object(
      'entity_type', 'marketplace_job',
      'preserved_driver_accepted_at', true,
      'returned_to_pool', true
    )
  );

  return jsonb_build_object('ok', true, 'preserved_driver_accepted_at', true);
end;
$$;

revoke all on function public.driver_integrity_reassign_marketplace_job(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_integrity_reassign_marketplace_job(uuid, uuid, uuid)
  to service_role;

revoke all on function public.minimum_pay_close_open_trip_interval(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.minimum_pay_close_open_trip_interval(text, uuid, text, timestamptz)
  to service_role;
