-- MMD Location Core — Phase 1 Africa (Guinea-first, multi-country structure)
-- Pin manual, landmarks, human directions, location photo, mmd_zones seed.

begin;

-- ---------------------------------------------------------------------------
-- 1) location_landmarks (before location_points FK)
-- ---------------------------------------------------------------------------

create table if not exists public.location_landmarks (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  region_name text,
  prefecture_name text,
  city_name text,
  commune_name text,
  quartier_name text,
  name text not null,
  landmark_type text not null default 'other'
    check (landmark_type in (
      'mosque', 'church', 'school', 'market', 'fuel_station', 'bank',
      'hotel', 'roundabout', 'bridge', 'mobile_money', 'other'
    )),
  lat double precision not null,
  lng double precision not null,
  provider text not null default 'mmd'
    check (provider in ('mmd', 'mapbox', 'community')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  confidence_score numeric(5, 2) not null default 50
    check (confidence_score >= 0 and confidence_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists location_landmarks_country_status_idx
  on public.location_landmarks (country_code, status);

create index if not exists location_landmarks_name_lower_idx
  on public.location_landmarks (country_code, lower(name));

-- ---------------------------------------------------------------------------
-- 2) location_points
-- ---------------------------------------------------------------------------

create table if not exists public.location_points (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  country_code text not null,
  region_name text,
  prefecture_name text,
  city_name text,
  commune_name text,
  quartier_name text,
  formatted_address text,
  directions_text text not null,
  geocoded_lat double precision,
  geocoded_lng double precision,
  pin_lat double precision not null,
  pin_lng double precision not null,
  accuracy_m numeric(10, 2),
  location_source text not null default 'pin'
    check (location_source in ('gps', 'pin', 'landmark', 'saved', 'community')),
  primary_landmark_id uuid references public.location_landmarks (id) on delete set null,
  location_photo_path text,
  confidence_score numeric(5, 2) not null default 0
    check (confidence_score >= 0 and confidence_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_points_directions_min_len
    check (char_length(trim(directions_text)) >= 8),
  constraint location_points_pin_coords_valid
    check (
      pin_lat between -90 and 90
      and pin_lng between -180 and 180
    )
);

create index if not exists location_points_owner_idx
  on public.location_points (owner_user_id, created_at desc);

create index if not exists location_points_country_idx
  on public.location_points (country_code, commune_name, quartier_name);

create index if not exists location_points_landmark_idx
  on public.location_points (primary_landmark_id);

-- ---------------------------------------------------------------------------
-- 3) mmd_zones
-- ---------------------------------------------------------------------------

create table if not exists public.mmd_zones (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  region_name text,
  prefecture_name text,
  city_name text,
  commune_name text,
  quartier_name text,
  zone_code text not null,
  zone_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mmd_zones_zone_code_unique unique (zone_code)
);

create index if not exists mmd_zones_country_active_idx
  on public.mmd_zones (country_code, is_active);

create index if not exists mmd_zones_search_idx
  on public.mmd_zones (country_code, region_name, prefecture_name, city_name, commune_name, quartier_name);

-- ---------------------------------------------------------------------------
-- 4) updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_mmd_location_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists location_landmarks_touch_updated_at on public.location_landmarks;
create trigger location_landmarks_touch_updated_at
  before update on public.location_landmarks
  for each row execute function public.touch_mmd_location_updated_at();

drop trigger if exists location_points_touch_updated_at on public.location_points;
create trigger location_points_touch_updated_at
  before update on public.location_points
  for each row execute function public.touch_mmd_location_updated_at();

drop trigger if exists mmd_zones_touch_updated_at on public.mmd_zones;
create trigger mmd_zones_touch_updated_at
  before update on public.mmd_zones
  for each row execute function public.touch_mmd_location_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS — location_landmarks
-- ---------------------------------------------------------------------------

alter table public.location_landmarks enable row level security;

drop policy if exists location_landmarks_select_approved on public.location_landmarks;
create policy location_landmarks_select_approved
  on public.location_landmarks
  for select
  to authenticated
  using (status = 'approved' or public.is_staff_user(auth.uid()));

drop policy if exists location_landmarks_insert_authenticated on public.location_landmarks;
create policy location_landmarks_insert_authenticated
  on public.location_landmarks
  for insert
  to authenticated
  with check (status = 'pending');

drop policy if exists location_landmarks_staff_all on public.location_landmarks;
create policy location_landmarks_staff_all
  on public.location_landmarks
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 6) RLS — location_points
-- ---------------------------------------------------------------------------

alter table public.location_points enable row level security;

drop policy if exists location_points_select_own on public.location_points;
create policy location_points_select_own
  on public.location_points
  for select
  to authenticated
  using (owner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists location_points_insert_own on public.location_points;
create policy location_points_insert_own
  on public.location_points
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists location_points_update_own on public.location_points;
create policy location_points_update_own
  on public.location_points
  for update
  to authenticated
  using (owner_user_id = auth.uid() or public.is_staff_user(auth.uid()))
  with check (owner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists location_points_delete_own on public.location_points;
create policy location_points_delete_own
  on public.location_points
  for delete
  to authenticated
  using (owner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 7) RLS — mmd_zones
-- ---------------------------------------------------------------------------

alter table public.mmd_zones enable row level security;

drop policy if exists mmd_zones_select_active on public.mmd_zones;
create policy mmd_zones_select_active
  on public.mmd_zones
  for select
  to authenticated
  using (is_active = true or public.is_staff_user(auth.uid()));

drop policy if exists mmd_zones_staff_all on public.mmd_zones;
create policy mmd_zones_staff_all
  on public.mmd_zones
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 8) Storage bucket — location-attachments
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('location-attachments', 'location-attachments', false)
on conflict (id) do update
set public = excluded.public;

create or replace function public.location_attachment_owner_from_path(p_object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(trim(p_object_name), '/', 1), '')::uuid;
$$;

create or replace function public.location_attachment_location_id_from_path(p_object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(trim(p_object_name), '/', 2), '')::uuid;
$$;

create or replace function public.user_owns_location_point(p_location_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.location_points lp
    where lp.id = p_location_id
      and lp.owner_user_id = p_user_id
  );
$$;

create or replace function public.user_can_read_location_attachment(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner uuid;
  v_location_id uuid;
begin
  if v_viewer is null then
    return false;
  end if;

  if public.is_staff_user(v_viewer) then
    return true;
  end if;

  v_owner := public.location_attachment_owner_from_path(p_object_name);
  v_location_id := public.location_attachment_location_id_from_path(p_object_name);

  if v_owner is null or v_location_id is null then
    return false;
  end if;

  if v_owner <> v_viewer then
    return false;
  end if;

  return public.user_owns_location_point(v_location_id, v_viewer);
end;
$$;

create or replace function public.user_can_upload_location_attachment(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner uuid;
  v_location_id uuid;
begin
  if v_viewer is null then
    return false;
  end if;

  v_owner := public.location_attachment_owner_from_path(p_object_name);
  v_location_id := public.location_attachment_location_id_from_path(p_object_name);

  if v_owner is null or v_location_id is null or v_owner <> v_viewer then
    return false;
  end if;

  return public.user_owns_location_point(v_location_id, v_viewer);
end;
$$;

drop policy if exists location_attachments_insert_owner on storage.objects;
create policy location_attachments_insert_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'location-attachments'
    and public.user_can_upload_location_attachment(name)
  );

drop policy if exists location_attachments_select_owner_or_staff on storage.objects;
create policy location_attachments_select_owner_or_staff
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'location-attachments'
    and public.user_can_read_location_attachment(name)
  );

drop policy if exists location_attachments_update_owner on storage.objects;
create policy location_attachments_update_owner
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'location-attachments'
    and public.user_can_upload_location_attachment(name)
  )
  with check (
    bucket_id = 'location-attachments'
    and public.user_can_upload_location_attachment(name)
  );

drop policy if exists location_attachments_delete_owner on storage.objects;
create policy location_attachments_delete_owner
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'location-attachments'
    and public.user_can_upload_location_attachment(name)
  );

revoke all on function public.location_attachment_owner_from_path(text) from public;
revoke all on function public.location_attachment_location_id_from_path(text) from public;
revoke all on function public.user_owns_location_point(uuid, uuid) from public;
revoke all on function public.user_can_read_location_attachment(text) from public;
revoke all on function public.user_can_upload_location_attachment(text) from public;

grant execute on function public.location_attachment_owner_from_path(text) to authenticated;
grant execute on function public.location_attachment_location_id_from_path(text) to authenticated;
grant execute on function public.user_owns_location_point(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_location_attachment(text) to authenticated;
grant execute on function public.user_can_upload_location_attachment(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Seed mmd_zones — Guinea (full country structure)
-- ---------------------------------------------------------------------------

insert into public.mmd_zones (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  zone_code, zone_name, is_active
) values
  ('GN', 'Conakry', 'Conakry', 'Conakry', null, null, 'gn_conakry', 'Conakry', true),
  ('GN', 'Boké', null, 'Boké', null, null, 'gn_boke', 'Boké', true),
  ('GN', 'Kindia', null, 'Kindia', null, null, 'gn_kindia', 'Kindia', true),
  ('GN', 'Mamou', null, 'Mamou', null, null, 'gn_mamou', 'Mamou', true),
  ('GN', 'Labé', null, 'Labé', null, null, 'gn_labe', 'Labé', true),
  ('GN', 'Faranah', null, 'Faranah', null, null, 'gn_faranah', 'Faranah', true),
  ('GN', 'Kankan', null, 'Kankan', null, null, 'gn_kankan', 'Kankan', true),
  ('GN', 'N''Zérékoré', null, 'N''Zérékoré', null, null, 'gn_nzerekore', 'N''Zérékoré', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Kaloum', null, 'gn_conakry_kaloum', 'Kaloum', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Dixinn', null, 'gn_conakry_dixinn', 'Dixinn', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matam', null, 'gn_conakry_matam', 'Matam', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', null, 'gn_conakry_matoto', 'Matoto', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Ratoma', null, 'gn_conakry_ratoma', 'Ratoma', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', 'Lambanyi', 'gn_conakry_matoto_lambanyi', 'Lambanyi', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', 'Kipé', 'gn_conakry_matoto_kipe', 'Kipé', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', 'Sonfonia', 'gn_conakry_matoto_sonfonia', 'Sonfonia', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Ratoma', 'Koloma', 'gn_conakry_ratoma_koloma', 'Koloma', true),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Ratoma', 'Kagbelen', 'gn_conakry_ratoma_kagbelen', 'Kagbelen', true),
  ('GN', 'Boké', 'Boké', 'Boké', null, null, 'gn_boke_prefecture', 'Préfecture de Boké', true),
  ('GN', 'Kindia', 'Kindia', 'Kindia', null, null, 'gn_kindia_prefecture', 'Préfecture de Kindia', true),
  ('GN', 'Mamou', 'Mamou', 'Mamou', null, null, 'gn_mamou_prefecture', 'Préfecture de Mamou', true),
  ('GN', 'Labé', 'Labé', 'Labé', null, null, 'gn_labe_prefecture', 'Préfecture de Labé', true),
  ('GN', 'Faranah', 'Faranah', 'Faranah', null, null, 'gn_faranah_prefecture', 'Préfecture de Faranah', true),
  ('GN', 'Kankan', 'Kankan', 'Kankan', null, null, 'gn_kankan_prefecture', 'Préfecture de Kankan', true),
  ('GN', 'N''Zérékoré', 'N''Zérékoré', 'N''Zérékoré', null, null, 'gn_nzerekore_prefecture', 'Préfecture de N''Zérékoré', true)
on conflict (zone_code) do update
set
  zone_name = excluded.zone_name,
  region_name = excluded.region_name,
  prefecture_name = excluded.prefecture_name,
  city_name = excluded.city_name,
  commune_name = excluded.commune_name,
  quartier_name = excluded.quartier_name,
  is_active = excluded.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 10) Seed mmd_zones — Senegal, Côte d'Ivoire, Mali (structure only, inactive)
-- ---------------------------------------------------------------------------

insert into public.mmd_zones (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  zone_code, zone_name, is_active
) values
  ('SN', 'Dakar', null, 'Dakar', null, null, 'sn_dakar', 'Dakar', false),
  ('SN', 'Dakar', 'Dakar', 'Dakar', 'Plateau', null, 'sn_dakar_plateau', 'Plateau', false),
  ('SN', 'Dakar', 'Dakar', 'Dakar', 'Almadies', null, 'sn_dakar_almadies', 'Almadies', false),
  ('SN', 'Dakar', 'Pikine', 'Pikine', 'Parcelles Assainies', null, 'sn_parcelles', 'Parcelles Assainies', false),
  ('SN', 'Dakar', 'Dakar', 'Dakar', 'Yoff', null, 'sn_dakar_yoff', 'Yoff', false),
  ('CI', 'Abidjan', null, 'Abidjan', null, null, 'ci_abidjan', 'Abidjan', false),
  ('CI', 'Abidjan', 'Abidjan', 'Abidjan', 'Cocody', null, 'ci_abidjan_cocody', 'Cocody', false),
  ('CI', 'Abidjan', 'Abidjan', 'Abidjan', 'Yopougon', null, 'ci_abidjan_yopougon', 'Yopougon', false),
  ('CI', 'Abidjan', 'Abidjan', 'Abidjan', 'Marcory', null, 'ci_abidjan_marcory', 'Marcory', false),
  ('ML', 'Bamako', null, 'Bamako', null, null, 'ml_bamako', 'Bamako', false),
  ('ML', 'Bamako', 'Bamako', 'Bamako', 'ACI 2000', null, 'ml_bamako_aci', 'ACI 2000', false),
  ('ML', 'Bamako', 'Bamako', 'Bamako', 'Hippodrome', null, 'ml_bamako_hippodrome', 'Hippodrome', false)
on conflict (zone_code) do update
set
  zone_name = excluded.zone_name,
  is_active = excluded.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 11) Sample approved landmarks — Conakry (internal testing)
-- ---------------------------------------------------------------------------

insert into public.location_landmarks (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  name, landmark_type, lat, lng, provider, status, confidence_score
) values
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', 'Lambanyi', 'Station Total Lambanyi', 'fuel_station', 9.6378, -13.5784, 'mmd', 'approved', 85),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', 'Kipé', 'Mosquée de Kipé', 'mosque', 9.6412, -13.6123, 'mmd', 'approved', 80),
  ('GN', 'Conakry', 'Conakry', 'Conakry', 'Matoto', null, 'Marché Madina', 'market', 9.6355, -13.5842, 'mmd', 'approved', 82);

commit;
