-- New public signups take their profile role from auth metadata.
-- Only the public allowlist is accepted. Privileged and unknown values
-- stay client. Existing profiles are not updated.
-- guard_profiles_privilege_columns() is unchanged and still freezes role
-- changes after the row exists, except for service_role.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested text := lower(trim(coalesce(new.raw_user_meta_data ->> 'role', '')));
  v_role text := 'client';
begin
  if v_requested in ('client', 'driver', 'restaurant', 'seller') then
    v_role := v_requested;
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile for a new auth user. Public roles client, driver, restaurant, and seller are taken from raw_user_meta_data.role. Every other value, including staff and admin, is stored as client. Does not update existing profiles.';

notify pgrst, 'reload schema';

commit;
