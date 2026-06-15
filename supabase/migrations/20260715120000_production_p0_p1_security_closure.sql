-- Production P0/P1 closure: privilege guards, pricing_config RLS, order_members RLS.

begin;

-- ---------------------------------------------------------------------------
-- P0-5: Prevent profiles privilege escalation (role, founder, account_status)
-- ---------------------------------------------------------------------------

create or replace function public.guard_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_staff_user() then
      new.role := 'client';
      new.is_founder := false;
      if new.account_status is distinct from 'active' then
        new.account_status := 'active';
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

drop trigger if exists guard_profiles_privilege_columns on public.profiles;

create trigger guard_profiles_privilege_columns
before insert or update on public.profiles
for each row
execute function public.guard_profiles_privilege_columns();

-- ---------------------------------------------------------------------------
-- P0-6: pricing_config — staff read only (writes via service_role / admin RPC)
-- ---------------------------------------------------------------------------

alter table public.pricing_config enable row level security;

drop policy if exists pricing_config_select_staff on public.pricing_config;

create policy pricing_config_select_staff
on public.pricing_config
for select
to authenticated
using (public.is_staff_user());

-- ---------------------------------------------------------------------------
-- P0-7: order_members — participant read only (writes via security definer RPCs)
-- ---------------------------------------------------------------------------

alter table public.order_members enable row level security;

drop policy if exists order_members_select_own on public.order_members;
drop policy if exists order_members_select_staff on public.order_members;

create policy order_members_select_own
on public.order_members
for select
to authenticated
using (user_id = auth.uid());

create policy order_members_select_staff
on public.order_members
for select
to authenticated
using (public.is_staff_user());

commit;
