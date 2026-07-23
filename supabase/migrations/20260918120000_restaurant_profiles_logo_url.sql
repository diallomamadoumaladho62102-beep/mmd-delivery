-- Minimal restaurant logo support on restaurant_profiles.
-- cover_image_url already exists (20260816120000). logo_url/avatar_url were used by
-- mobile setup + home UI but never added by a tracked restaurant migration.

begin;

alter table public.restaurant_profiles
  add column if not exists logo_url text;

alter table public.restaurant_profiles
  add column if not exists avatar_url text;

comment on column public.restaurant_profiles.logo_url is
  'Storage path or public URL for restaurant logo (avatars bucket: restaurants/{user_id}/logo.jpg).';

comment on column public.restaurant_profiles.avatar_url is
  'Optional mirror of logo_url for clients that historically read avatar_url.';

commit;
