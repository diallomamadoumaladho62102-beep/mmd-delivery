-- ===========================================================================
-- Client Home advertisements (CMS) + impression/click analytics
-- Images live in Storage bucket `advertisements` (public URLs) — never in app binary.
-- ===========================================================================

begin;

create table if not exists public.advertisements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text not null,
  button_text text,
  button_action text,
  placement text not null default 'client_home',
  category text not null default 'Campagnes MMD',
  country text,
  city text,
  language text,
  audience text,
  priority integer not null default 0,
  display_order integer not null default 0,
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertisements_title_len check (char_length(title) between 1 and 160),
  constraint advertisements_subtitle_len check (subtitle is null or char_length(subtitle) <= 280),
  constraint advertisements_image_url_len check (char_length(image_url) between 1 and 2000),
  constraint advertisements_button_text_len check (button_text is null or char_length(button_text) <= 80),
  constraint advertisements_button_action_len check (button_action is null or char_length(button_action) <= 500),
  constraint advertisements_placement_len check (char_length(placement) between 1 and 64),
  constraint advertisements_category_len check (char_length(category) between 1 and 80)
);

create index if not exists advertisements_active_placement_idx
  on public.advertisements (placement, is_active, priority desc, display_order asc)
  where is_active = true;

create index if not exists advertisements_schedule_idx
  on public.advertisements (start_date, end_date)
  where is_active = true;

create table if not exists public.advertisement_impressions (
  id uuid primary key default gen_random_uuid(),
  advertisement_id uuid not null references public.advertisements (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  country text,
  city text,
  language text,
  placement text,
  created_at timestamptz not null default now()
);

create index if not exists advertisement_impressions_ad_created_idx
  on public.advertisement_impressions (advertisement_id, created_at desc);

create index if not exists advertisement_impressions_geo_idx
  on public.advertisement_impressions (country, city, created_at desc);

create table if not exists public.advertisement_clicks (
  id uuid primary key default gen_random_uuid(),
  advertisement_id uuid not null references public.advertisements (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  country text,
  city text,
  language text,
  placement text,
  created_at timestamptz not null default now()
);

create index if not exists advertisement_clicks_ad_created_idx
  on public.advertisement_clicks (advertisement_id, created_at desc);

create index if not exists advertisement_clicks_geo_idx
  on public.advertisement_clicks (country, city, created_at desc);

alter table public.advertisements enable row level security;
alter table public.advertisement_impressions enable row level security;
alter table public.advertisement_clicks enable row level security;

-- Clients never read ads tables directly — API uses service role.
-- No public SELECT policies on ads tables.

comment on table public.advertisements is
  'CMS creatives for client home (and other placements). image_url must be a Storage/CDN URL.';
comment on table public.advertisement_impressions is
  'Impression events for advertisement CTR analytics.';
comment on table public.advertisement_clicks is
  'Click events for advertisement CTR analytics.';

-- Public storage bucket for ad creatives (URLs only in app).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'advertisements',
  'advertisements',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read for ad images; writes go through service role / admin API.
drop policy if exists advertisements_storage_public_read on storage.objects;
create policy advertisements_storage_public_read
  on storage.objects
  for select
  to public
  using (bucket_id = 'advertisements');

commit;
