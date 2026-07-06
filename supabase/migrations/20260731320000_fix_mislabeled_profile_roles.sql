-- Idempotent production fix: align profiles.role with driver_profiles / restaurant_profiles.

begin;

update public.profiles p
set role = 'driver'
from public.driver_profiles dp
where dp.user_id = p.id
  and coalesce(p.role, '') <> 'driver'
  and coalesce(p.role, '') not in ('admin', 'ops', 'support', 'finance', 'review');

update public.profiles p
set role = 'restaurant'
from public.restaurant_profiles rp
where rp.user_id = p.id
  and coalesce(p.role, '') <> 'restaurant'
  and coalesce(p.role, '') not in ('admin', 'ops', 'support', 'finance', 'review');

commit;
