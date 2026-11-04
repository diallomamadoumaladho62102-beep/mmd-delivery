-- Expand restaurant_profiles.status to match admin review API + Control Center UI.
-- Previously CHECK allowed only pending|approved|rejected, so Suspend/Disable always failed.

alter table public.restaurant_profiles
  drop constraint if exists restaurant_profiles_status_check;

alter table public.restaurant_profiles
  add constraint restaurant_profiles_status_check
  check (
    status = any (
      array[
        'pending'::text,
        'approved'::text,
        'rejected'::text,
        'suspended'::text,
        'disabled'::text
      ]
    )
  );
