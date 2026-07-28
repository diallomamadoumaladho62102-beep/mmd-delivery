-- Tighten finance_account_categories grants: authenticated SELECT only.
-- Mutations remain service_role (admin finance APIs). Staff SELECT policy stays.

begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.finance_account_categories
  from authenticated;

-- Keep staff write policy only if future authenticated staff clients need it;
-- with INSERT revoked, policy is inert for non-service roles — drop write policy
-- to avoid a false sense of client-writable finance reference data.
drop policy if exists finance_account_categories_staff_write
  on public.finance_account_categories;

notify pgrst, 'reload schema';

commit;
