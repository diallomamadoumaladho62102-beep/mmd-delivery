-- Fix signup: allow self-service roles (client, driver, restaurant) on INSERT
-- while still blocking privilege escalation to staff roles.

begin;

create or replace function public.guard_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_staff_user() then
      new.is_founder := false;
      if new.account_status is distinct from 'active' then
        new.account_status := 'active';
      end if;
      if new.role is null or new.role not in ('client', 'driver', 'restaurant') then
        new.role := 'client';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not public.is_staff_user() then
      new.role := old.role;
      new.is_founder := old.is_founder;
      if new.account_status is distinct from old.account_status then
        new.account_status := old.account_status;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

commit;
