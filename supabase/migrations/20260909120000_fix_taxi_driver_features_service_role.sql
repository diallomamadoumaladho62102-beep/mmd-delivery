-- Allow service_role (admin API via Supabase secret key) to set taxi_enabled.
-- guard_taxi_driver_features_self_update previously required is_staff_user(auth.uid()),
-- which fails for service_role JWTs (auth.uid() is null) and blocks PATCH /api/admin/taxi-drivers.

begin;

create or replace function public.guard_taxi_driver_features_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_auth_role text := '';
begin
  begin
    v_auth_role := coalesce(auth.role(), '');
  exception
    when others then
      v_auth_role := '';
  end;

  -- Admin routes use the secret/service key; opaque sb_secret may leave jwt role empty.
  if v_jwt_role = 'service_role'
     or session_user::text = 'service_role'
     or current_user::text = 'service_role'
     or v_auth_role = 'service_role'
     or public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    NEW.taxi_enabled := false;
    NEW.xl_eligible := false;
    NEW.premium_eligible := false;
    NEW.passenger_capacity := 4;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.taxi_enabled is distinct from NEW.taxi_enabled
       or OLD.xl_eligible is distinct from NEW.xl_eligible
       or OLD.premium_eligible is distinct from NEW.premium_eligible
       or OLD.passenger_capacity is distinct from NEW.passenger_capacity then
      raise exception 'taxi_driver_features_staff_only_fields';
    end if;
  end if;

  return NEW;
end;
$$;

commit;
