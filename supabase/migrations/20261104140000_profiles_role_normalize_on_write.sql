-- Enforce canonical profiles.role on every write.
-- Legacy short names (admin/ops/…) are normalized before CHECK; they are no
-- longer accepted as stored values.

begin;

create or replace function public.normalize_profile_role(p_role text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_role, '')));
begin
  if v = '' then
    return null;
  end if;

  v := replace(replace(v, ' ', '_'), '-', '_');

  return case v
    when 'customer' then 'client'
    when 'livreur' then 'driver'
    when 'chauffeur' then 'driver'
    when 'vendeur' then 'seller'
    when 'merchant' then 'seller'
    when 'merchant_owner' then 'seller'
    when 'restaurant_owner' then 'restaurant'
    when 'restaurantowner' then 'restaurant'
    when 'admin' then 'super_admin'
    when 'superadmin' then 'super_admin'
    when 'ops' then 'operations_admin'
    when 'operationsadmin' then 'operations_admin'
    when 'finance' then 'finance_admin'
    when 'financeadmin' then 'finance_admin'
    when 'support' then 'support_admin'
    when 'supportadmin' then 'support_admin'
    when 'review' then 'review_admin'
    when 'reviewadmin' then 'review_admin'
    when 'founder' then 'super_admin'
    else v
  end;
end;
$$;

create or replace function public.trg_normalize_profiles_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not null then
    new.role := public.normalize_profile_role(new.role::text);
  end if;
  if coalesce(new.is_founder, false) = true then
    new.role := 'super_admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_profiles_role on public.profiles;
create trigger trg_normalize_profiles_role
  before insert or update of role, is_founder
  on public.profiles
  for each row
  execute function public.trg_normalize_profiles_role();

-- Final sweep: no short staff names remain stored.
update public.profiles
set role = public.normalize_profile_role(role)
where role is not null
  and role is distinct from public.normalize_profile_role(role);

-- Tighten CHECK: stored values must be canonical only (no short legacy).
alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role = any (
      array[
        'client',
        'driver',
        'restaurant',
        'restaurant_manager',
        'restaurant_staff',
        'seller',
        'merchant_manager',
        'merchant_staff',
        'business_owner',
        'business_manager',
        'super_admin',
        'operations_admin',
        'finance_admin',
        'support_admin',
        'review_admin',
        'developer',
        'system'
      ]
    )
  );

notify pgrst, 'reload schema';

commit;
