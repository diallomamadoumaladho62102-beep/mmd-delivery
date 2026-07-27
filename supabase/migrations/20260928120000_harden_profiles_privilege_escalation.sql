-- Harden profiles privilege columns against staff self-escalation.
--
-- BUG: guard_profiles_privilege_columns allowed any staff JWT to change
-- role / is_founder on their own row (is_staff_user() skipped the freeze).
-- Worse, `if new.is_founder is true then lock as founder` turned a self-set
-- flag into permanent Super Admin, bypassing every assertStaffPermission gate.
--
-- FIX:
-- 1) Existing founders remain locked (cannot be demoted via client JWT).
-- 2) Authenticated JWT sessions (auth.uid() present) can NEVER change
--    role / is_founder / account_status — including staff.
-- 3) Privilege mutations are reserved for service_role admin APIs
--    (auth.uid() is null under the service role key).

begin;

create or replace function public.guard_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), '')
  );
  v_is_service boolean := coalesce(v_jwt_role, '') = 'service_role';
begin
  if tg_op = 'INSERT' then
    -- Client signups must never create staff / founder rows.
    if not v_is_service then
      new.is_founder := false;
      if new.account_status is distinct from 'active' then
        new.account_status := 'active';
      end if;
      if new.role is null
         or lower(trim(coalesce(new.role::text, ''))) not in (
           'client', 'driver', 'restaurant'
         )
      then
        new.role := 'client';
      end if;
    end if;

    -- Service-role founder create must stay Super Admin.
    if new.is_founder is true then
      new.role := 'admin';
      new.account_status := 'active';
      new.is_founder := true;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Durable founder lock: cannot demote an existing founder via any path
    -- that isn't an intentional service_role admin operation that also
    -- clears is_founder (we still refuse demotion here — founders are
    -- only restored via dedicated migrations / service ops that disable
    -- this trigger, matching prior restore_founder migrations).
    if old.is_founder is true then
      new.is_founder := true;
      new.role := 'admin';
      new.account_status := 'active';
      return new;
    end if;

    -- Authenticated end-user / staff JWT: freeze privilege columns.
    -- Admin Control Center mutations use the service role key and skip this.
    if not v_is_service then
      new.role := old.role;
      new.is_founder := old.is_founder;
      if new.account_status is distinct from old.account_status then
        new.account_status := old.account_status;
      end if;
    end if;

    -- Belt-and-suspenders: never allow elevating to founder without
    -- service_role (blocks the previous self-set is_founder=true path).
    if new.is_founder is true and not v_is_service then
      new.is_founder := old.is_founder;
      new.role := old.role;
    end if;

    return new;
  end if;

  return new;
end;
$$;

comment on function public.guard_profiles_privilege_columns() is
  'Freeze profiles.role/is_founder/account_status for authenticated JWTs; service_role admin APIs only. Existing founders cannot be demoted.';

commit;
