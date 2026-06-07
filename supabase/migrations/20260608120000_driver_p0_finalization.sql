-- Driver P0 finalization: schema alignment, storage bucket, suspend enforcement, RLS.

begin;

-- ---------------------------------------------------------------------------
-- 1) driver_profiles — align with production (user_id, onboarding, dispatch)
-- ---------------------------------------------------------------------------

create table if not exists public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  emergency_phone text,
  address text,
  city text,
  state text,
  zip_code text,
  date_of_birth date,
  transport_mode text default 'bike',
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  plate_number text,
  license_number text,
  license_expiry date,
  photo_url text,
  is_online boolean not null default false,
  total_deliveries integer not null default 0,
  acceptance_rate numeric,
  cancellation_rate numeric,
  rating numeric,
  rating_count integer not null default 0,
  vehicle_verified boolean not null default false,
  payout_enabled boolean not null default false,
  documents_required boolean not null default true,
  stripe_account_id text,
  stripe_onboarded boolean not null default false,
  stripe_onboarded_at timestamptz,
  driver_score numeric,
  driver_tier integer,
  last_assigned_at timestamptz,
  status text not null default 'pending',
  missing_requirements text,
  onboarding_status text not null default 'draft',
  is_locked boolean not null default false,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $migrate_driver_profiles$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_profiles'
      and column_name = 'courier_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_profiles'
      and column_name = 'user_id'
  ) then
    alter table public.driver_profiles rename column courier_id to user_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_profiles'
      and column_name = 'courier_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_profiles'
      and column_name = 'user_id'
  ) then
    update public.driver_profiles
    set user_id = courier_id
    where user_id is null;
  end if;
end
$migrate_driver_profiles$;

alter table public.driver_profiles add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.driver_profiles add column if not exists full_name text;
alter table public.driver_profiles add column if not exists phone text;
alter table public.driver_profiles add column if not exists emergency_phone text;
alter table public.driver_profiles add column if not exists address text;
alter table public.driver_profiles add column if not exists city text;
alter table public.driver_profiles add column if not exists state text;
alter table public.driver_profiles add column if not exists zip_code text;
alter table public.driver_profiles add column if not exists date_of_birth date;
alter table public.driver_profiles add column if not exists transport_mode text default 'bike';
alter table public.driver_profiles add column if not exists vehicle_type text;
alter table public.driver_profiles add column if not exists vehicle_brand text;
alter table public.driver_profiles add column if not exists vehicle_model text;
alter table public.driver_profiles add column if not exists vehicle_year integer;
alter table public.driver_profiles add column if not exists vehicle_color text;
alter table public.driver_profiles add column if not exists plate_number text;
alter table public.driver_profiles add column if not exists license_number text;
alter table public.driver_profiles add column if not exists license_expiry date;
alter table public.driver_profiles add column if not exists photo_url text;
alter table public.driver_profiles add column if not exists is_online boolean not null default false;
alter table public.driver_profiles add column if not exists total_deliveries integer not null default 0;
alter table public.driver_profiles add column if not exists acceptance_rate numeric;
alter table public.driver_profiles add column if not exists cancellation_rate numeric;
alter table public.driver_profiles add column if not exists rating numeric;
alter table public.driver_profiles add column if not exists rating_count integer not null default 0;
alter table public.driver_profiles add column if not exists vehicle_verified boolean not null default false;
alter table public.driver_profiles add column if not exists payout_enabled boolean not null default false;
alter table public.driver_profiles add column if not exists documents_required boolean not null default true;
alter table public.driver_profiles add column if not exists stripe_account_id text;
alter table public.driver_profiles add column if not exists stripe_onboarded boolean not null default false;
alter table public.driver_profiles add column if not exists stripe_onboarded_at timestamptz;
alter table public.driver_profiles add column if not exists driver_score numeric;
alter table public.driver_profiles add column if not exists driver_tier integer;
alter table public.driver_profiles add column if not exists last_assigned_at timestamptz;
alter table public.driver_profiles add column if not exists status text not null default 'pending';
alter table public.driver_profiles add column if not exists missing_requirements text;
alter table public.driver_profiles add column if not exists onboarding_status text not null default 'draft';
alter table public.driver_profiles add column if not exists is_locked boolean not null default false;
alter table public.driver_profiles add column if not exists locked_at timestamptz;
alter table public.driver_profiles add column if not exists created_at timestamptz not null default now();
alter table public.driver_profiles add column if not exists updated_at timestamptz not null default now();

update public.driver_profiles
set user_id = id
where user_id is null
  and id is not null;

create unique index if not exists driver_profiles_user_id_uidx
  on public.driver_profiles (user_id);

create index if not exists driver_profiles_status_online_idx
  on public.driver_profiles (status, is_online);

-- ---------------------------------------------------------------------------
-- 2) driver_documents
-- ---------------------------------------------------------------------------

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  driver_id uuid references public.driver_profiles (id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  country text,
  state text,
  doc_number text,
  expires_at text,
  status text not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_documents_status_check
    check (status in ('pending', 'approved', 'rejected', 'incomplete'))
);

create unique index if not exists driver_documents_user_doc_type_uidx
  on public.driver_documents (user_id, doc_type);

create index if not exists driver_documents_user_id_created_idx
  on public.driver_documents (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) driver_locations
-- ---------------------------------------------------------------------------

create table if not exists public.driver_locations (
  driver_id uuid primary key references auth.users (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

create index if not exists driver_locations_updated_at_idx
  on public.driver_locations (updated_at desc);

-- ---------------------------------------------------------------------------
-- 4) driver_payouts — ensure table + driver read RLS
-- ---------------------------------------------------------------------------

create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'canceled', 'failed')),
  stripe_transfer_id text,
  stripe_payout_id text,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_payouts_driver_id_created_at_idx
  on public.driver_payouts (driver_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Operational helpers + suspend enforcement triggers
-- ---------------------------------------------------------------------------

create or replace function public.is_driver_operational(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_profiles dp
    where dp.user_id = p_user_id
      and lower(coalesce(dp.status, '')) = 'approved'
  );
$$;

create or replace function public.enforce_driver_profile_online_rules()
returns trigger
language plpgsql
as $$
begin
  if coalesce(lower(new.status), '') in ('suspended', 'disabled') then
    new.is_online := false;
  end if;

  if new.is_online is true
     and coalesce(lower(new.status), '') <> 'approved' then
    raise exception 'driver_not_eligible_for_online'
      using hint = 'Driver must be approved to go online.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_driver_profiles_online_rules on public.driver_profiles;
create trigger trg_driver_profiles_online_rules
before insert or update on public.driver_profiles
for each row execute function public.enforce_driver_profile_online_rules();

-- ---------------------------------------------------------------------------
-- 6) Accept-offer RPCs — block suspended / non-approved drivers
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_order_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.driver_order_offers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  select *
  into v_offer
  from public.driver_order_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  select *
  into v_order
  from public.orders
  where id = v_offer.order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if coalesce(lower(v_order.kind), '') <> 'food' then
    return jsonb_build_object('ok', false, 'message', 'invalid_order_kind');
  end if;

  if coalesce(lower(v_order.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'order_not_paid');
  end if;

  if coalesce(lower(v_order.status), '') <> 'ready' then
    return jsonb_build_object('ok', false, 'message', 'order_not_ready');
  end if;

  if v_order.driver_id is not null and v_order.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  update public.orders
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_order.id
    and driver_id is null
    and lower(status) = 'ready';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_no_longer_available');
  end if;

  update public.driver_order_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.driver_order_offers
  set status = 'superseded', updated_at = now()
  where order_id = v_offer.order_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object('ok', true, 'order_id', v_order.id);
end;
$$;

create or replace function public.driver_accept_delivery_request_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.delivery_request_driver_offers%rowtype;
  v_request public.delivery_requests%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  select *
  into v_offer
  from public.delivery_request_driver_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  select *
  into v_request
  from public.delivery_requests
  where id = v_offer.delivery_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_found');
  end if;

  if coalesce(lower(v_request.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'request_not_paid');
  end if;

  if v_request.driver_id is not null and v_request.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  if lower(coalesce(v_request.status, '')) not in (
    'pending',
    'paid_pending',
    'processing_pending'
  ) then
    return jsonb_build_object('ok', false, 'message', 'request_not_available');
  end if;

  perform public.ensure_delivery_request_codes(v_request.id);

  update public.delivery_requests
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_request.id
    and driver_id is null
    and coalesce(payment_status, '') = 'paid'
    and lower(status) in ('pending', 'paid_pending', 'processing_pending');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_no_longer_available');
  end if;

  update public.delivery_request_driver_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.delivery_request_driver_offers
  set status = 'superseded', updated_at = now()
  where delivery_request_id = v_offer.delivery_request_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object('ok', true, 'delivery_request_id', v_request.id);
end;
$$;

revoke all on function public.is_driver_operational(uuid) from public;
grant execute on function public.is_driver_operational(uuid) to authenticated;

revoke all on function public.driver_accept_order_offer(uuid) from public;
revoke all on function public.driver_accept_delivery_request_offer(uuid) from public;
grant execute on function public.driver_accept_order_offer(uuid) to authenticated;
grant execute on function public.driver_accept_delivery_request_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) RLS — driver_profiles, driver_documents, driver_locations, driver_payouts
-- ---------------------------------------------------------------------------

alter table public.driver_profiles enable row level security;
alter table public.driver_documents enable row level security;
alter table public.driver_locations enable row level security;
alter table public.driver_payouts enable row level security;

drop policy if exists driver_profiles_select_own on public.driver_profiles;
create policy driver_profiles_select_own
  on public.driver_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists driver_profiles_insert_own on public.driver_profiles;
create policy driver_profiles_insert_own
  on public.driver_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid() and coalesce(is_locked, false) = false);

drop policy if exists driver_profiles_update_if_not_locked on public.driver_profiles;
create policy driver_profiles_update_if_not_locked
  on public.driver_profiles
  for update
  to authenticated
  using (user_id = auth.uid() and coalesce(is_locked, false) = false)
  with check (user_id = auth.uid() and coalesce(is_locked, false) = false);

drop policy if exists driver_profiles_select_staff on public.driver_profiles;
create policy driver_profiles_select_staff
  on public.driver_profiles
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()) or user_id = auth.uid());

drop policy if exists driver_documents_select_own on public.driver_documents;
create policy driver_documents_select_own
  on public.driver_documents
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists driver_documents_insert_own on public.driver_documents;
create policy driver_documents_insert_own
  on public.driver_documents
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists driver_documents_update_own on public.driver_documents;
create policy driver_documents_update_own
  on public.driver_documents
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists driver_documents_select_staff on public.driver_documents;
create policy driver_documents_select_staff
  on public.driver_documents
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()) or user_id = auth.uid());

drop policy if exists driver_locations_select_own on public.driver_locations;
create policy driver_locations_select_own
  on public.driver_locations
  for select
  to authenticated
  using (driver_id = auth.uid());

drop policy if exists driver_locations_upsert_own on public.driver_locations;
create policy driver_locations_upsert_own
  on public.driver_locations
  for insert
  to authenticated
  with check (
    driver_id = auth.uid()
    and public.is_driver_operational(auth.uid())
  );

drop policy if exists driver_locations_update_own on public.driver_locations;
create policy driver_locations_update_own
  on public.driver_locations
  for update
  to authenticated
  using (driver_id = auth.uid() and public.is_driver_operational(auth.uid()))
  with check (driver_id = auth.uid() and public.is_driver_operational(auth.uid()));

drop policy if exists driver_locations_select_staff on public.driver_locations;
create policy driver_locations_select_staff
  on public.driver_locations
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()) or driver_id = auth.uid());

drop policy if exists driver_payouts_select_own on public.driver_payouts;
create policy driver_payouts_select_own
  on public.driver_payouts
  for select
  to authenticated
  using (driver_id = auth.uid());

drop policy if exists driver_payouts_select_staff on public.driver_payouts;
create policy driver_payouts_select_staff
  on public.driver_payouts
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()) or driver_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8) Storage — canonical bucket driver-docs (path: drivers/{uid}/...)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('driver-docs', 'driver-docs', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists driver_docs_select_own on storage.objects;
create policy driver_docs_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists driver_docs_insert_own on storage.objects;
create policy driver_docs_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists driver_docs_update_own on storage.objects;
create policy driver_docs_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists driver_docs_delete_own on storage.objects;
create policy driver_docs_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'driver-docs'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Legacy bucket read-only for drivers (older uploads under {uid}/...)
drop policy if exists driver_documents_select_own on storage.objects;
create policy driver_documents_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
