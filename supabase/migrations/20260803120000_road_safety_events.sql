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
  -- Explicit legal state for camera-warning categories. When not 'allowed',
  -- speed/red-light camera alerts are NOT surfaced even if their enable flag is
  -- true. 'unknown' must never auto-activate camera alerts in production.
  legal_status text not null default 'unknown'
    check (legal_status in ('allowed', 'restricted', 'unknown', 'disabled')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_road_safety_country_config_updated_at on public.road_safety_country_config;
create trigger trg_road_safety_country_config_updated_at
before update on public.road_safety_country_config
for each row execute function public.taxi_set_updated_at();

-- Seed conservative, legally-aware defaults for supported markets.
-- legal_status gates the camera categories:
--   allowed    → camera warnings permitted (surfaced when enable flag on)
--   restricted → known legal limits (e.g. FR exact-location warnings) → OFF
--   disabled   → explicitly forbidden while driving (e.g. DE) → OFF
--   unknown    → no confirmed legal framework → NOT auto-activated in prod
-- enable_* is the admin toggle; effective camera display = enable AND allowed.
insert into public.road_safety_country_config
  (country_code, enable_speed_camera, enable_red_light_camera, legal_status)
values
  ('US', true, true, 'allowed'),
  ('GB', true, true, 'allowed'),
  ('CA', true, true, 'restricted'),   -- radar-warning legality varies by province
  ('FR', false, false, 'restricted'), -- exact camera-location warnings illegal
  ('BE', false, false, 'restricted'),
  ('DE', false, false, 'disabled'),   -- forbidden while driving
  ('GN', true, true, 'unknown'),
  ('SN', true, true, 'unknown'),
  ('CI', true, true, 'unknown'),
  ('ML', true, true, 'unknown'),
  ('NG', true, true, 'unknown'),
  ('GH', true, true, 'unknown'),
  ('SL', true, true, 'unknown'),
  ('MR', true, true, 'unknown')
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

-- Configured ingestion zones (small urban corridors — never national bboxes).
create table if not exists public.road_safety_ingest_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  south double precision not null check (south between -90 and 90),
  west double precision not null check (west between -180 and 180),
  north double precision not null check (north between -90 and 90),
  east double precision not null check (east between -180 and 180),
  -- Guard rails: reject anything larger than ~0.5° (keeps Overpass load small).
  constraint road_safety_ingest_zones_bbox_ok
    check (north > south and east > west and (north - south) <= 0.5 and (east - west) <= 0.5),
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly')),
  ttl_hours integer not null default 168 check (ttl_hours between 1 and 720),
  is_active boolean not null default true,
  last_ingested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_road_safety_ingest_zones_updated_at on public.road_safety_ingest_zones;
create trigger trg_road_safety_ingest_zones_updated_at
before update on public.road_safety_ingest_zones
for each row execute function public.taxi_set_updated_at();

-- Ingestion run audit + no-overlap lock (unique running run per zone).
create table if not exists public.road_safety_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.road_safety_ingest_zones (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  fetched integer not null default 0,
  mapped integer not null default 0,
  upserted integer not null default 0,
  attempts integer not null default 1,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists road_safety_ingest_runs_zone_idx
  on public.road_safety_ingest_runs (zone_id, started_at desc);
-- At most one 'running' run per zone → prevents overlapping ingestions.
create unique index if not exists road_safety_ingest_runs_one_running
  on public.road_safety_ingest_runs (zone_id)
  where status = 'running';

alter table public.road_safety_ingest_zones enable row level security;
alter table public.road_safety_ingest_runs enable row level security;

drop policy if exists road_safety_ingest_zones_staff on public.road_safety_ingest_zones;
create policy road_safety_ingest_zones_staff
  on public.road_safety_ingest_zones for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

drop policy if exists road_safety_ingest_runs_staff on public.road_safety_ingest_runs;
create policy road_safety_ingest_runs_staff
  on public.road_safety_ingest_runs for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

-- Seed small test corridors (urban only; ~0.05–0.15° boxes).
insert into public.road_safety_ingest_zones
  (name, country_code, south, west, north, east, frequency)
values
  ('Conakry centre', 'GN', 9.500, -13.720, 9.560, -13.660, 'weekly'),
  ('Dakar Plateau',  'SN', 14.660, -17.450, 14.700, -17.410, 'weekly'),
  ('Abidjan Plateau','CI', 5.300, -4.040, 5.350, -3.990, 'weekly'),
  ('Brooklyn NY',    'US', 40.660, -73.980, 40.700, -73.930, 'weekly'),
  ('Montréal centre','CA', 45.490, -73.590, 45.520, -73.550, 'weekly')
on conflict do nothing;

commit;
