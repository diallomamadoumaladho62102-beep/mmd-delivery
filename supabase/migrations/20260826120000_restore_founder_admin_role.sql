-- Restore official founder account to Super Admin (profiles.role = 'admin').
-- Cause: is_founder was true but role was incorrectly set to 'restaurant',
-- so AdminGate / resolveAdminSession denied hub.access (staff roles only).
-- Scoped to a single known founder user_id. Does not weaken RBAC/RLS.

begin;

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
    'reason', 'restore_founder_super_admin',
    'source', 'migration_20260826120000',
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

commit;
