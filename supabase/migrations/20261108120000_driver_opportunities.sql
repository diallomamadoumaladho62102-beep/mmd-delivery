-- Driver opportunities catalog + align existing save/signup tables.
-- Existing tables already use driver_id + text opportunity_id (legacy demo ids allowed).
-- Do not drop production rows; orphan demo ids simply will not match catalog UUIDs.

-- -----------------------------------------------------------------------------
-- 1) Core opportunities catalog
-- -----------------------------------------------------------------------------
create table if not exists public.driver_opportunities (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('saved', 'promotions', 'airports', 'reservations', 'events')),
  title text not null,
  subtitle text,
  starts_at timestamptz,
  ends_at timestamptz,
  lat double precision,
  lng double precision,
  bonus_cents integer not null default 0,
  currency text not null default 'USD',
  capacity integer,
  status text not null default 'published'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_opportunities_coords_valid check (
    (lat is null and lng is null)
    or (lat between -90 and 90 and lng between -180 and 180)
  ),
  constraint driver_opportunities_capacity_positive check (
    capacity is null or capacity > 0
  )
);

comment on table public.driver_opportunities is
  'Published driver shift/promotion opportunities shown in the mobile Opportunities feed.';

create index if not exists driver_opportunities_starts_at_idx
  on public.driver_opportunities (starts_at);

create index if not exists driver_opportunities_category_idx
  on public.driver_opportunities (category);

create index if not exists driver_opportunities_status_idx
  on public.driver_opportunities (status);

create index if not exists driver_opportunities_published_day_idx
  on public.driver_opportunities (status, category, starts_at)
  where status = 'published';

drop trigger if exists trg_driver_opportunities_set_updated_at on public.driver_opportunities;
create trigger trg_driver_opportunities_set_updated_at
before update on public.driver_opportunities
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2) Saved opportunities (existing table: driver_id + text opportunity_id)
-- -----------------------------------------------------------------------------
create table if not exists public.driver_saved_opportunities (
  driver_id uuid not null references auth.users (id) on delete cascade,
  opportunity_id text not null,
  created_at timestamptz not null default now(),
  primary key (driver_id, opportunity_id)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_saved_opportunities'
      and column_name = 'driver_user_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_saved_opportunities'
      and column_name = 'driver_id'
  ) then
    alter table public.driver_saved_opportunities rename column driver_user_id to driver_id;
  end if;
end $$;

create index if not exists driver_saved_opportunities_driver_idx
  on public.driver_saved_opportunities (driver_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3) Opportunity signups (existing table: driver_id + text opportunity_id)
-- -----------------------------------------------------------------------------
create table if not exists public.driver_opportunity_signups (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete cascade,
  opportunity_id text not null,
  created_at timestamptz not null default now(),
  constraint driver_opportunity_signups_unique_driver_opp
    unique (driver_id, opportunity_id)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_opportunity_signups'
      and column_name = 'driver_user_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_opportunity_signups'
      and column_name = 'driver_id'
  ) then
    alter table public.driver_opportunity_signups rename column driver_user_id to driver_id;
  end if;
end $$;

create index if not exists driver_opportunity_signups_opportunity_idx
  on public.driver_opportunity_signups (opportunity_id, created_at desc);

create index if not exists driver_opportunity_signups_driver_idx
  on public.driver_opportunity_signups (driver_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4) RLS (driver_reviews already exists with a different product schema — leave alone)
-- -----------------------------------------------------------------------------
alter table public.driver_opportunities enable row level security;
alter table public.driver_saved_opportunities enable row level security;
alter table public.driver_opportunity_signups enable row level security;

drop policy if exists driver_opportunities_select_published on public.driver_opportunities;
create policy driver_opportunities_select_published
on public.driver_opportunities
for select
to authenticated
using (
  status = 'published'
  and public.is_authenticated_driver(auth.uid())
);

drop policy if exists driver_opportunities_service_role_all on public.driver_opportunities;
create policy driver_opportunities_service_role_all
on public.driver_opportunities
for all
to service_role
using (true)
with check (true);

drop policy if exists driver_saved_opportunities_select_own on public.driver_saved_opportunities;
create policy driver_saved_opportunities_select_own
on public.driver_saved_opportunities
for select
to authenticated
using (driver_id = auth.uid());

drop policy if exists driver_saved_opportunities_insert_own on public.driver_saved_opportunities;
create policy driver_saved_opportunities_insert_own
on public.driver_saved_opportunities
for insert
to authenticated
with check (
  driver_id = auth.uid()
  and public.is_authenticated_driver(auth.uid())
);

drop policy if exists driver_saved_opportunities_delete_own on public.driver_saved_opportunities;
create policy driver_saved_opportunities_delete_own
on public.driver_saved_opportunities
for delete
to authenticated
using (driver_id = auth.uid());

drop policy if exists driver_saved_opportunities_service_role_all on public.driver_saved_opportunities;
create policy driver_saved_opportunities_service_role_all
on public.driver_saved_opportunities
for all
to service_role
using (true)
with check (true);

drop policy if exists driver_opportunity_signups_select_own on public.driver_opportunity_signups;
create policy driver_opportunity_signups_select_own
on public.driver_opportunity_signups
for select
to authenticated
using (driver_id = auth.uid());

drop policy if exists driver_opportunity_signups_insert_own on public.driver_opportunity_signups;
create policy driver_opportunity_signups_insert_own
on public.driver_opportunity_signups
for insert
to authenticated
with check (
  driver_id = auth.uid()
  and public.is_authenticated_driver(auth.uid())
);

drop policy if exists driver_opportunity_signups_delete_own on public.driver_opportunity_signups;
create policy driver_opportunity_signups_delete_own
on public.driver_opportunity_signups
for delete
to authenticated
using (driver_id = auth.uid());

drop policy if exists driver_opportunity_signups_service_role_all on public.driver_opportunity_signups;
create policy driver_opportunity_signups_service_role_all
on public.driver_opportunity_signups
for all
to service_role
using (true)
with check (true);
