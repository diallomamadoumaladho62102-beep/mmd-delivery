-- Protect founder Super Admin access permanently.
-- Regression: is_founder stayed true while profiles.role was demoted to
-- 'restaurant' (e.g. RestaurantSetup upsert + staff privilege guard allowing
-- staff self-role changes). Admin gates only honored staff roles, so the
-- founder was locked out of /admin while remaining marked as founder.
--
-- Root fix:
-- 1) Restore the official founder row to role='admin'.
-- 2) RLS helpers honor is_founder.
-- 3) Harden guard_profiles_privilege_columns so founders always keep
--    role='admin', is_founder=true, account_status='active'.

begin;

-- 1) Restore official founder Super Admin (scoped single user).
alter table public.profiles disable trigger guard_profiles_privilege_columns;

update public.profiles
set
  role = 'admin',
  account_status = 'active',
  is_founder = true
where id = '379cb6a0-2e6e-43f5-b2de-dacac7144c94'
  and lower(email) = lower('diallomamadoumaladho621@gmail.com');

alter table public.profiles enable trigger guard_profiles_privilege_columns;

insert into public.admin_audit_logs (
  admin_user_id,
  action,
  target_type,
  target_id,
  metadata,
  old_values,
  new_values
)
select
  '379cb6a0-2e6e-43f5-b2de-dacac7144c94'::uuid,
  'admin_role_changed',
  'profile',
  '379cb6a0-2e6e-43f5-b2de-dacac7144c94',
  jsonb_build_object(
    'reason', 'protect_founder_super_admin',
    'source', 'migration_20260911120000',
    'email_masked', 'diallomamadoumaladho621@***'
  ),
  jsonb_build_object(
    'role', 'restaurant',
    'is_founder', true,
    'account_status', 'active'
  ),
  jsonb_build_object(
    'role', 'admin',
    'is_founder', true,
    'account_status', 'active'
  )
where exists (
  select 1
  from public.profiles
  where id = '379cb6a0-2e6e-43f5-b2de-dacac7144c94'
    and role = 'admin'
    and is_founder = true
);

-- 2) RLS helpers: is_founder is a durable Super Admin / staff signal.
create or replace function public.is_staff_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        coalesce(p.is_founder, false) = true
        or lower(trim(coalesce(p.role::text, ''))) in (
          'admin', 'ops', 'finance', 'support', 'review'
        )
      )
  );
$$;

create or replace function public.is_super_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        coalesce(p.is_founder, false) = true
        or lower(trim(coalesce(p.role::text, ''))) = 'admin'
      )
  );
$$;

-- 3) Harden privilege guard: founders cannot be demoted via client/staff writes.
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

    if new.is_founder is true then
      new.role := 'admin';
      new.account_status := 'active';
      new.is_founder := true;
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

    -- Durable founder Super Admin lock (covers staff self-updates / upserts).
    if old.is_founder is true or new.is_founder is true then
      new.is_founder := true;
      new.role := 'admin';
      new.account_status := 'active';
    end if;

    return new;
  end if;

  return new;
end;
$$;

commit;
