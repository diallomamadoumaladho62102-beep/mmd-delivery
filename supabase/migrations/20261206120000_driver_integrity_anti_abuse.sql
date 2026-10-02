-- Driver Integrity / Anti-Abuse (operational). Feature flags default OFF.
-- Does not activate Minimum Pay, does not send transfers, does not backfill
-- historical trips, and never deletes admissible time or due earnings.

begin;

-- ---------------------------------------------------------------------------
-- Settings singleton — all business thresholds Admin-owned (NULL until set)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_integrity_settings (
  singleton boolean primary key default true check (singleton),
  monitoring_enabled boolean not null default false,
  warning_notifications_enabled boolean not null default false,
  reassignment_enabled boolean not null default false,
  contact_enabled boolean not null default false,
  review_enabled boolean not null default false,
  sanction_workflow_enabled boolean not null default false,
  driver_acceptance_warning_after_seconds integer
    check (driver_acceptance_warning_after_seconds is null or driver_acceptance_warning_after_seconds > 0),
  driver_no_progress_reassignment_after_seconds integer
    check (driver_no_progress_reassignment_after_seconds is null or driver_no_progress_reassignment_after_seconds > 0),
  driver_pickup_progress_warning_after_seconds integer
    check (driver_pickup_progress_warning_after_seconds is null or driver_pickup_progress_warning_after_seconds > 0),
  driver_no_progress_review_after_seconds integer
    check (driver_no_progress_review_after_seconds is null or driver_no_progress_review_after_seconds > 0),
  restaurant_wait_review_threshold_seconds integer
    check (restaurant_wait_review_threshold_seconds is null or restaurant_wait_review_threshold_seconds > 0),
  long_trip_threshold_seconds integer
    check (long_trip_threshold_seconds is null or long_trip_threshold_seconds > 0),
  stationary_threshold_seconds integer
    check (stationary_threshold_seconds is null or stationary_threshold_seconds > 0),
  impossible_speed_threshold_mps numeric
    check (impossible_speed_threshold_mps is null or impossible_speed_threshold_mps > 0),
  gps_stale_after_seconds integer
    check (gps_stale_after_seconds is null or gps_stale_after_seconds > 0),
  gps_jump_threshold_meters integer
    check (gps_jump_threshold_meters is null or gps_jump_threshold_meters > 0),
  movement_progress_threshold_meters integer
    check (movement_progress_threshold_meters is null or movement_progress_threshold_meters > 0),
  require_change_reason boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.driver_integrity_settings (singleton)
values (true)
on conflict (singleton) do nothing;

comment on table public.driver_integrity_settings is
  'Driver integrity / anti-abuse settings. Flags default OFF. Thresholds are Admin-owned; never seed business values.';

create table if not exists public.driver_integrity_settings_revisions (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  change_reason text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists driver_integrity_settings_revisions_created_idx
  on public.driver_integrity_settings_revisions (created_at desc);

-- ---------------------------------------------------------------------------
-- Incidents / warnings / wait reasons / reviews / disputes / events
-- ---------------------------------------------------------------------------
create table if not exists public.driver_integrity_incidents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'delivery_request')),
  entity_id uuid not null,
  original_driver_id uuid not null,
  original_driver_accepted_at timestamptz not null,
  status text not null default 'open'
    check (status in (
      'open', 'warning', 'final_warning', 'reassigned', 'review',
      'confirmed', 'not_confirmed', 'policy_action', 'closed'
    )),
  last_case text,
  last_anomalies jsonb not null default '[]'::jsonb,
  severity text not null default 'info'
    check (severity in ('info', 'low', 'medium', 'high')),
  accept_lat double precision,
  accept_lng double precision,
  evidence jsonb not null default '{}'::jsonb,
  reassigned_at timestamptz,
  reassigned_by text,
  review_opened_at timestamptz,
  review_decision text
    check (review_decision is null or review_decision in ('confirmed', 'not_confirmed')),
  review_decided_at timestamptz,
  review_decided_by uuid,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists driver_integrity_incidents_open_uniq
  on public.driver_integrity_incidents (entity_type, entity_id, original_driver_id)
  where status not in ('closed');

create index if not exists driver_integrity_incidents_driver_idx
  on public.driver_integrity_incidents (original_driver_id, created_at desc);

create index if not exists driver_integrity_incidents_status_idx
  on public.driver_integrity_incidents (status, created_at desc);

comment on column public.driver_integrity_incidents.original_driver_accepted_at is
  'Immutable server timestamp copied from the assignment. Never rewritten on reassignment.';

create table if not exists public.driver_integrity_warnings (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.driver_integrity_incidents (id) on delete cascade,
  warning_kind text not null check (warning_kind in ('first', 'final')),
  sent_at timestamptz not null default now(),
  unique (incident_id, warning_kind)
);

create table if not exists public.driver_wait_reasons (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'delivery_request')),
  entity_id uuid not null,
  driver_id uuid not null,
  incident_id uuid references public.driver_integrity_incidents (id) on delete set null,
  reason_code text not null check (reason_code in (
    'restaurant_delay', 'order_issue', 'traffic', 'gps_issue',
    'technical_issue', 'vehicle_issue', 'safety_issue', 'other'
  )),
  explanation text,
  created_at timestamptz not null default now()
);

create index if not exists driver_wait_reasons_entity_idx
  on public.driver_wait_reasons (entity_type, entity_id, created_at desc);

create table if not exists public.driver_integrity_reviews (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.driver_integrity_incidents (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'confirmed', 'not_confirmed', 'closed')),
  decision_notes text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (incident_id)
);

create table if not exists public.driver_integrity_policy_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.driver_integrity_incidents (id) on delete cascade,
  action text not null check (action in (
    'warning', 'additional_review', 'temporary_restriction', 'suspension', 'none'
  )),
  notes text,
  decided_by uuid not null,
  decided_at timestamptz not null default now()
);

create table if not exists public.driver_trip_disputes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'delivery_request')),
  entity_id uuid not null,
  driver_id uuid not null,
  incident_id uuid references public.driver_integrity_incidents (id) on delete set null,
  reason_code text not null check (reason_code in (
    'restaurant_delay', 'order_issue', 'traffic', 'gps_issue',
    'technical_issue', 'vehicle_issue', 'safety_issue', 'other'
  )),
  explanation text,
  status text not null default 'open'
    check (status in ('open', 'under_review', 'resolved', 'closed')),
  original_driver_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_trip_disputes_driver_idx
  on public.driver_trip_disputes (driver_id, created_at desc);

create table if not exists public.driver_integrity_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.driver_integrity_incidents (id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists driver_integrity_events_incident_idx
  on public.driver_integrity_events (incident_id, created_at desc);

create table if not exists public.driver_integrity_contacts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.driver_integrity_incidents (id) on delete set null,
  driver_id uuid not null,
  admin_user_id uuid not null,
  channel text not null,
  reason text,
  notification_log_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists driver_integrity_contacts_driver_idx
  on public.driver_integrity_contacts (driver_id, created_at desc);

create table if not exists public.driver_integrity_gps_samples (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'delivery_request')),
  entity_id uuid not null,
  driver_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  captured_at timestamptz not null default now()
);

create index if not exists driver_integrity_gps_samples_entity_idx
  on public.driver_integrity_gps_samples (entity_type, entity_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Immutability: original accept clock / wait-reason / dispute timestamps
-- ---------------------------------------------------------------------------
create or replace function public.driver_integrity_freeze_incident_clock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.entity_type := old.entity_type;
  new.entity_id := old.entity_id;
  new.original_driver_id := old.original_driver_id;
  new.original_driver_accepted_at := old.original_driver_accepted_at;
  return new;
end;
$$;

drop trigger if exists trg_driver_integrity_freeze_incident_clock
  on public.driver_integrity_incidents;
create trigger trg_driver_integrity_freeze_incident_clock
  before update on public.driver_integrity_incidents
  for each row
  execute function public.driver_integrity_freeze_incident_clock();

create or replace function public.driver_integrity_freeze_wait_reason()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.entity_type := old.entity_type;
  new.entity_id := old.entity_id;
  new.driver_id := old.driver_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_driver_integrity_freeze_wait_reason
  on public.driver_wait_reasons;
create trigger trg_driver_integrity_freeze_wait_reason
  before update on public.driver_wait_reasons
  for each row
  execute function public.driver_integrity_freeze_wait_reason();

create or replace function public.driver_integrity_freeze_dispute_clock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.entity_type := old.entity_type;
  new.entity_id := old.entity_id;
  new.driver_id := old.driver_id;
  new.created_at := old.created_at;
  new.original_driver_accepted_at := coalesce(old.original_driver_accepted_at, new.original_driver_accepted_at);
  return new;
end;
$$;

drop trigger if exists trg_driver_integrity_freeze_dispute_clock
  on public.driver_trip_disputes;
create trigger trg_driver_integrity_freeze_dispute_clock
  before update on public.driver_trip_disputes
  for each row
  execute function public.driver_integrity_freeze_dispute_clock();

-- ---------------------------------------------------------------------------
-- Atomic reassignment (service_role only). Does not erase driver_accepted_at.
-- ---------------------------------------------------------------------------
create or replace function public.driver_integrity_reassign_order(
  p_order_id uuid,
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
  v_order public.orders%rowtype;
  v_incident public.driver_integrity_incidents%rowtype;
  v_accepted timestamptz;
begin
  select * into v_settings
  from public.driver_integrity_settings
  where singleton = true;
  if not found
     or v_settings.monitoring_enabled is not true
     or v_settings.reassignment_enabled is not true then
    return jsonb_build_object('ok', false, 'message', 'reassignment_disabled');
  end if;

  select * into v_incident
  from public.driver_integrity_incidents
  where id = p_incident_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'incident_not_found');
  end if;
  if v_incident.reassigned_at is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'already_reassigned',
      'idempotent', true,
      'order_id', p_order_id,
      'original_driver_id', v_incident.original_driver_id,
      'original_driver_accepted_at', v_incident.original_driver_accepted_at
    );
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if v_order.driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_assignment');
  end if;
  if v_order.driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('ok', false, 'message', 'driver_mismatch');
  end if;
  if v_order.picked_up_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_picked_up');
  end if;
  if v_order.delivered_at is not null
     or v_order.delivered_confirmed_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_delivered');
  end if;
  if v_order.cancelled_at is not null
     or lower(coalesce(v_order.status, '')) in ('canceled', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'already_cancelled');
  end if;
  if lower(coalesce(v_order.status, '')) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'message', 'stale_state');
  end if;

  v_accepted := coalesce(v_order.driver_accepted_at, v_incident.original_driver_accepted_at);

  update public.orders
  set
    driver_id = null,
    status = 'ready',
    updated_at = now()
  where id = p_order_id
    and driver_id = p_expected_driver_id
    and picked_up_at is null
    and delivered_at is null
    and cancelled_at is null
    and lower(status) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'concurrent_assignment');
  end if;

  update public.driver_order_offers
  set status = 'expired', updated_at = now()
  where order_id = p_order_id
    and status = 'pending';

  update public.driver_integrity_incidents
  set
    status = 'reassigned',
    reassigned_at = now(),
    reassigned_by = 'system',
    updated_at = now()
  where id = p_incident_id
    and reassigned_at is null;

  insert into public.driver_integrity_events (incident_id, event_type, payload)
  values (
    p_incident_id,
    'DRIVER_ORDER_REASSIGNED',
    jsonb_build_object(
      'order_id', p_order_id,
      'original_driver_id', p_expected_driver_id,
      'original_driver_accepted_at', v_accepted,
      'preserved_driver_accepted_at', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'original_driver_id', p_expected_driver_id,
    'original_driver_accepted_at', v_accepted,
    'idempotent', false
  );
end;
$$;

create or replace function public.driver_integrity_reassign_delivery_request(
  p_request_id uuid,
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
  v_req public.delivery_requests%rowtype;
  v_incident public.driver_integrity_incidents%rowtype;
  v_accepted timestamptz;
begin
  select * into v_settings
  from public.driver_integrity_settings
  where singleton = true;
  if not found
     or v_settings.monitoring_enabled is not true
     or v_settings.reassignment_enabled is not true then
    return jsonb_build_object('ok', false, 'message', 'reassignment_disabled');
  end if;

  select * into v_incident
  from public.driver_integrity_incidents
  where id = p_incident_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'incident_not_found');
  end if;
  if v_incident.reassigned_at is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'already_reassigned',
      'idempotent', true,
      'delivery_request_id', p_request_id,
      'original_driver_id', v_incident.original_driver_id,
      'original_driver_accepted_at', v_incident.original_driver_accepted_at
    );
  end if;

  select * into v_req
  from public.delivery_requests
  where id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_found');
  end if;
  if v_req.driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_assignment');
  end if;
  if v_req.driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('ok', false, 'message', 'driver_mismatch');
  end if;
  if v_req.picked_up_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_picked_up');
  end if;
  if v_req.delivered_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_delivered');
  end if;
  if v_req.cancelled_at is not null
     or lower(coalesce(v_req.status, '')) in ('canceled', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'already_cancelled');
  end if;
  if lower(coalesce(v_req.status, '')) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'message', 'stale_state');
  end if;

  v_accepted := coalesce(v_req.driver_accepted_at, v_incident.original_driver_accepted_at);

  update public.delivery_requests
  set
    driver_id = null,
    status = 'pending',
    updated_at = now()
  where id = p_request_id
    and driver_id = p_expected_driver_id
    and picked_up_at is null
    and delivered_at is null
    and cancelled_at is null
    and lower(status) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'concurrent_assignment');
  end if;

  update public.delivery_request_driver_offers
  set status = 'expired', updated_at = now()
  where delivery_request_id = p_request_id
    and status = 'pending';

  update public.driver_integrity_incidents
  set
    status = 'reassigned',
    reassigned_at = now(),
    reassigned_by = 'system',
    updated_at = now()
  where id = p_incident_id
    and reassigned_at is null;

  insert into public.driver_integrity_events (incident_id, event_type, payload)
  values (
    p_incident_id,
    'DRIVER_ORDER_REASSIGNED',
    jsonb_build_object(
      'delivery_request_id', p_request_id,
      'original_driver_id', p_expected_driver_id,
      'original_driver_accepted_at', v_accepted,
      'preserved_driver_accepted_at', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delivery_request_id', p_request_id,
    'original_driver_id', p_expected_driver_id,
    'original_driver_accepted_at', v_accepted,
    'idempotent', false
  );
end;
$$;

revoke all on function public.driver_integrity_reassign_order(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.driver_integrity_reassign_delivery_request(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_integrity_reassign_order(uuid, uuid, uuid)
  to service_role;
grant execute on function public.driver_integrity_reassign_delivery_request(uuid, uuid, uuid)
  to service_role;

revoke all on function public.driver_integrity_freeze_incident_clock()
  from public, anon, authenticated;
revoke all on function public.driver_integrity_freeze_wait_reason()
  from public, anon, authenticated;
revoke all on function public.driver_integrity_freeze_dispute_clock()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.driver_integrity_settings enable row level security;
alter table public.driver_integrity_settings_revisions enable row level security;
alter table public.driver_integrity_incidents enable row level security;
alter table public.driver_integrity_warnings enable row level security;
alter table public.driver_wait_reasons enable row level security;
alter table public.driver_integrity_reviews enable row level security;
alter table public.driver_integrity_policy_actions enable row level security;
alter table public.driver_trip_disputes enable row level security;
alter table public.driver_integrity_events enable row level security;
alter table public.driver_integrity_contacts enable row level security;
alter table public.driver_integrity_gps_samples enable row level security;

drop policy if exists driver_integrity_settings_staff_read on public.driver_integrity_settings;
create policy driver_integrity_settings_staff_read
  on public.driver_integrity_settings for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists driver_integrity_revisions_staff_read on public.driver_integrity_settings_revisions;
create policy driver_integrity_revisions_staff_read
  on public.driver_integrity_settings_revisions for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists driver_integrity_incidents_read on public.driver_integrity_incidents;
create policy driver_integrity_incidents_read
  on public.driver_integrity_incidents for select
  using (
    original_driver_id = auth.uid()
    or public.is_staff_user(auth.uid())
  );

drop policy if exists driver_integrity_warnings_read on public.driver_integrity_warnings;
create policy driver_integrity_warnings_read
  on public.driver_integrity_warnings for select
  using (
    public.is_staff_user(auth.uid())
    or exists (
      select 1 from public.driver_integrity_incidents i
      where i.id = incident_id and i.original_driver_id = auth.uid()
    )
  );

drop policy if exists driver_wait_reasons_read on public.driver_wait_reasons;
create policy driver_wait_reasons_read
  on public.driver_wait_reasons for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists driver_wait_reasons_driver_insert on public.driver_wait_reasons;
create policy driver_wait_reasons_driver_insert
  on public.driver_wait_reasons for insert
  with check (driver_id = auth.uid());

drop policy if exists driver_integrity_reviews_staff_read on public.driver_integrity_reviews;
create policy driver_integrity_reviews_staff_read
  on public.driver_integrity_reviews for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists driver_integrity_policy_staff_read on public.driver_integrity_policy_actions;
create policy driver_integrity_policy_staff_read
  on public.driver_integrity_policy_actions for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists driver_trip_disputes_read on public.driver_trip_disputes;
create policy driver_trip_disputes_read
  on public.driver_trip_disputes for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists driver_trip_disputes_driver_insert on public.driver_trip_disputes;
create policy driver_trip_disputes_driver_insert
  on public.driver_trip_disputes for insert
  with check (driver_id = auth.uid());

drop policy if exists driver_integrity_events_read on public.driver_integrity_events;
create policy driver_integrity_events_read
  on public.driver_integrity_events for select
  using (
    public.is_staff_user(auth.uid())
    or exists (
      select 1 from public.driver_integrity_incidents i
      where i.id = incident_id and i.original_driver_id = auth.uid()
    )
  );

drop policy if exists driver_integrity_contacts_staff_read on public.driver_integrity_contacts;
create policy driver_integrity_contacts_staff_read
  on public.driver_integrity_contacts for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists driver_integrity_gps_staff_read on public.driver_integrity_gps_samples;
create policy driver_integrity_gps_staff_read
  on public.driver_integrity_gps_samples for select
  using (public.is_staff_user(auth.uid()));

grant select on public.driver_integrity_settings to authenticated;
grant select on public.driver_integrity_settings_revisions to authenticated;
grant select on public.driver_integrity_incidents to authenticated;
grant select on public.driver_integrity_warnings to authenticated;
grant select, insert on public.driver_wait_reasons to authenticated;
grant select on public.driver_integrity_reviews to authenticated;
grant select on public.driver_integrity_policy_actions to authenticated;
grant select, insert on public.driver_trip_disputes to authenticated;
grant select on public.driver_integrity_events to authenticated;
grant select on public.driver_integrity_contacts to authenticated;
grant select on public.driver_integrity_gps_samples to authenticated;

grant all on public.driver_integrity_settings to service_role;
grant all on public.driver_integrity_settings_revisions to service_role;
grant all on public.driver_integrity_incidents to service_role;
grant all on public.driver_integrity_warnings to service_role;
grant all on public.driver_wait_reasons to service_role;
grant all on public.driver_integrity_reviews to service_role;
grant all on public.driver_integrity_policy_actions to service_role;
grant all on public.driver_trip_disputes to service_role;
grant all on public.driver_integrity_events to service_role;
grant all on public.driver_integrity_contacts to service_role;
grant all on public.driver_integrity_gps_samples to service_role;

notify pgrst, 'reload schema';

commit;
