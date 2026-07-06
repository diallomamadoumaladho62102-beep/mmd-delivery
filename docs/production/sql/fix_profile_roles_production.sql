-- Production profile role integrity check + auto-fix (idempotent).
-- Safe to re-run: only updates profiles where role mismatches linked domain profile.

begin;

-- Report before fix
create temp table if not exists _profile_role_audit as
select
  p.id,
  p.role as current_role,
  case
    when dp.user_id is not null then 'driver'
    when rp.user_id is not null then 'restaurant'
    else 'client'
  end as expected_role
from public.profiles p
left join public.driver_profiles dp on dp.user_id = p.id
left join public.restaurant_profiles rp on rp.user_id = p.id
where (
  (dp.user_id is not null and coalesce(p.role, '') <> 'driver')
  or (rp.user_id is not null and coalesce(p.role, '') <> 'restaurant')
);

-- Fix driver profiles mislabeled as client/other (staff roles untouched)
update public.profiles p
set role = 'driver', updated_at = now()
from public.driver_profiles dp
where dp.user_id = p.id
  and coalesce(p.role, '') <> 'driver'
  and coalesce(p.role, '') not in ('admin', 'ops', 'support', 'finance', 'review');

-- Fix restaurant profiles mislabeled
update public.profiles p
set role = 'restaurant', updated_at = now()
from public.restaurant_profiles rp
where rp.user_id = p.id
  and coalesce(p.role, '') <> 'restaurant'
  and coalesce(p.role, '') not in ('admin', 'ops', 'support', 'finance', 'review');

commit;

-- Verification queries (run after script)
-- select count(*) as driver_role_mismatch
-- from public.driver_profiles dp
-- join public.profiles p on p.id = dp.user_id
-- where p.role <> 'driver';
--
-- select count(*) as restaurant_role_mismatch
-- from public.restaurant_profiles rp
-- join public.profiles p on p.id = rp.user_id
-- where p.role <> 'restaurant';
--
-- select count(*) as non_staff_privileged_roles
-- from public.profiles
-- where role in ('admin','ops','support','finance','review')
--   and coalesce(is_founder, false) = false;
