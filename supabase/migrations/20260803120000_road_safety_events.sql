-- Road-safety events + per-country configuration for driver navigation.
--
-- Data model aggregates multiple providers into one table:
--   source ∈ ('osm','manual','tomtom','here', …)
-- OpenStreetMap data is ODbL-licensed → attribution "© OpenStreetMap
-- contributors" is required by the client; share-alike applies to the stored
-- derived DB. Speed-camera warnings are legally restricted in some countries,
-- so each category is gated per country in road_safety_country_config and can
-- be disabled without a mobile build.
--
-- No PostGIS in this repo → coordinates stored as double precision with a
-- (latitude, longitude) btree index and bounding-box range queries.

begin;

create table if not exists public.road_safety_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (
    type in (
      'speed_camera',
      'red_light_camera',
      'speed_limit',
      'stop_sign',
      'school_zone'
    )
  ),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  source text not null default 'manual',
  -- External identifier for dedup (e.g. OSM 'node/123456').
  source_ref text,
  confidence numeric(3, 2) not null default 0.50 check (confidence between 0 and 1),
  direction text not null default 'unknown'
    check (direction in ('forward', 'backward', 'both', 'unknown')),
  bearing double precision check (bearing >= 0 and bearing < 360),
  speed_limit_kmh integer check (speed_limit_kmh is null or speed_limit_kmh > 0),
  -- Only populated when the source provides reliable, parseable hours.
  schedule jsonb,
  provider_meta jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cached/ingested rows expire so stale provider data is never served.
  expires_at timestamptz,
  unique (source, source_ref)
);

create index if not exists road_safety_events_lat_lng_idx
  on public.road_safety_events (latitude, longitude);
create index if not exists road_safety_events_country_idx
  on public.road_safety_events (country_code);
create index if not exists road_safety_events_type_idx
  on public.road_safety_events (type);
create index if not exists road_safety_events_active_idx
  on public.road_safety_events (is_active)
  where is_active = true;

drop trigger if exists trg_road_safety_events_updated_at on public.road_safety_events;
create trigger trg_road_safety_events_updated_at
before update on public.road_safety_events
for each row execute function public.taxi_set_updated_at();

-- Per-country configuration (legal gating + thresholds + tolerances).
create table if not exists public.road_safety_country_config (
  id uuid primary key default gen_random_uuid(),
  country_code text not null unique check (country_code ~ '^[A-Z]{2}$'),
  enable_speed_camera boolean not null default false,
  enable_red_light_camera boolean not null default false,
  enable_stop_sign boolean not null default true,
  enable_school_zone boolean not null default true,
  enable_speed_limit boolean not null default true,
  enable_voice boolean not null default true,
  announce_far_meters integer not null default 500 check (announce_far_meters between 100 and 1500),
  announce_near_meters integer not null default 200 check (announce_near_meters between 50 and 800),
  overspeed_tolerance_kmh integer not null default 10 check (overspeed_tolerance_kmh between 0 and 40),
  corridor_radius_meters integer not null default 25 check (corridor_radius_meters between 5 and 80),
  min_confidence numeric(3, 2) not null default 0.50 check (min_confidence between 0 and 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_road_safety_country_config_updated_at on public.road_safety_country_config;
create trigger trg_road_safety_country_config_updated_at
before update on public.road_safety_country_config
for each row execute function public.taxi_set_updated_at();

-- Seed conservative, legally-aware defaults for supported markets.
-- Speed-camera warnings enabled where generally permitted; left disabled where
-- legally restricted (e.g. FR/DE/BE) — adjust from Admin without a build.
insert into public.road_safety_country_config
  (country_code, enable_speed_camera, enable_red_light_camera)
values
  ('US', true, true),
  ('CA', true, true),
  ('GN', true, true),
  ('SN', true, true),
  ('CI', true, true),
  ('ML', true, true),
  ('NG', true, true),
  ('GH', true, true),
  ('SL', true, true),
  ('MR', true, true),
  ('GB', false, false),
  ('FR', false, false),
  ('BE', false, false),
  ('DE', false, false)
on conflict (country_code) do nothing;

-- RLS: events + config are non-secret and readable by the app; writes are
-- restricted to staff / service role (Edge Function ingestion).
alter table public.road_safety_events enable row level security;

drop policy if exists road_safety_events_select_active on public.road_safety_events;
create policy road_safety_events_select_active
  on public.road_safety_events for select
  to anon, authenticated
  using (is_active = true and (expires_at is null or expires_at > now()));

drop policy if exists road_safety_events_write_staff on public.road_safety_events;
create policy road_safety_events_write_staff
  on public.road_safety_events for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

alter table public.road_safety_country_config enable row level security;

drop policy if exists road_safety_country_config_select on public.road_safety_country_config;
create policy road_safety_country_config_select
  on public.road_safety_country_config for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists road_safety_country_config_write_staff on public.road_safety_country_config;
create policy road_safety_country_config_write_staff
  on public.road_safety_country_config for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

commit;
