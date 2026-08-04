-- Canonical profiles.role CHECK + staff helper alignment.
-- Expands profiles_role_check beyond client|driver|restaurant|admin so staff
-- roles (operations_admin / legacy ops, etc.) and marketplace seller succeed.
-- Migrates legacy short staff names to canonical long form.

begin;

-- 1) Normalize legacy / alias role strings before tightening CHECK.
update public.profiles
set role = case lower(trim(role))
  when 'customer' then 'client'
  when 'livreur' then 'driver'
  when 'chauffeur' then 'driver'
  when 'vendeur' then 'seller'
  when 'merchant' then 'seller'
  when 'merchant_owner' then 'seller'
  when 'restaurant_owner' then 'restaurant'
  when 'admin' then 'super_admin'
  when 'ops' then 'operations_admin'
  when 'finance' then 'finance_admin'
  when 'support' then 'support_admin'
  when 'review' then 'review_admin'
  when 'superadmin' then 'super_admin'
  when 'operationsadmin' then 'operations_admin'
  when 'financeadmin' then 'finance_admin'
  when 'supportadmin' then 'support_admin'
  when 'reviewadmin' then 'review_admin'
  when 'finance-admin' then 'finance_admin'
  when 'operations-admin' then 'operations_admin'
  when 'support-admin' then 'support_admin'
  when 'review-admin' then 'review_admin'
  when 'super-admin' then 'super_admin'
  else lower(trim(role))
end
where role is not null
  and lower(trim(role)) is distinct from case lower(trim(role))
    when 'customer' then 'client'
    when 'livreur' then 'driver'
    when 'chauffeur' then 'driver'
    when 'vendeur' then 'seller'
    when 'merchant' then 'seller'
    when 'merchant_owner' then 'seller'
    when 'restaurant_owner' then 'restaurant'
    when 'admin' then 'super_admin'
    when 'ops' then 'operations_admin'
    when 'finance' then 'finance_admin'
    when 'support' then 'support_admin'
    when 'review' then 'review_admin'
    when 'superadmin' then 'super_admin'
    when 'operationsadmin' then 'operations_admin'
    when 'financeadmin' then 'finance_admin'
    when 'supportadmin' then 'support_admin'
    when 'reviewadmin' then 'review_admin'
    when 'finance-admin' then 'finance_admin'
    when 'operations-admin' then 'operations_admin'
    when 'support-admin' then 'support_admin'
    when 'review-admin' then 'review_admin'
    when 'super-admin' then 'super_admin'
    else lower(trim(role))
  end;

-- Founders keep durable privilege flag; ensure role is super_admin when founder.
update public.profiles
set role = 'super_admin'
where coalesce(is_founder, false) = true
  and lower(trim(coalesce(role, ''))) not in (
    'super_admin', 'founder', 'admin'
  );

-- 2) Replace CHECK with canonical allow-list (keeps legacy short names too).
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role = any (
      array[
        -- public
        'client',
        'customer',
        'driver',
        -- restaurant
        'restaurant',
        'restaurant_owner',
        'restaurant_manager',
        'restaurant_staff',
        -- marketplace
        'seller',
        'merchant',
        'merchant_owner',
        'merchant_manager',
        'merchant_staff',
        -- business
        'business_owner',
        'business_manager',
        -- administration (canonical)
        'founder',
        'super_admin',
        'operations_admin',
        'finance_admin',
        'support_admin',
        'review_admin',
        -- legacy short staff (accepted; app normalizes on write)
        'admin',
        'ops',
        'finance',
        'support',
        'review',
        -- platform
        'developer',
        'system'
      ]
    )
  );

-- 3) Staff / super-admin helpers accept canonical + legacy short names.
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
          'founder',
          'super_admin',
          'operations_admin',
          'finance_admin',
          'support_admin',
          'review_admin',
          'admin',
          'ops',
          'finance',
          'support',
          'review'
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
        or lower(trim(coalesce(p.role::text, ''))) in (
          'super_admin',
          'founder',
          'admin'
        )
      )
  );
$$;

-- 4) Privilege guard: public INSERT allowlist includes seller; founders → super_admin.
create or replace function public.guard_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_is_service boolean := coalesce(v_jwt_role, '') = 'service_role';
  v_allow_restore text := coalesce(
    nullif(current_setting('mmd.allow_account_restore', true), ''),
    ''
  );
  v_role text;
begin
  if tg_op = 'INSERT' then
    if not v_is_service then
      new.is_founder := false;
      if new.account_status is distinct from 'active' then
        new.account_status := 'active';
      end if;
      v_role := lower(trim(coalesce(new.role::text, '')));
      if v_role = 'customer' then
        v_role := 'client';
      end if;
      if v_role not in ('client', 'driver', 'restaurant', 'seller') then
        v_role := 'client';
      end if;
      new.role := v_role;
    end if;

    if new.is_founder is true then
      new.role := 'super_admin';
      new.account_status := 'active';
      new.is_founder := true;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_founder is true then
      new.is_founder := true;
      new.role := 'super_admin';
      new.account_status := 'active';
      return new;
    end if;

    if old.account_status = 'deleted'
       and new.account_status is distinct from 'deleted'
       and v_allow_restore <> '1'
    then
      raise exception 'deleted accounts cannot be restored without mmd.allow_account_restore';
    end if;

    if not v_is_service then
      new.role := old.role;
      new.is_founder := old.is_founder;
      if new.account_status is distinct from old.account_status then
        new.account_status := old.account_status;
      end if;
    end if;

    if new.is_founder is true and not v_is_service then
      new.is_founder := old.is_founder;
      new.role := old.role;
    end if;

    return new;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
