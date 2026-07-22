-- Allow authenticated clients to read active advertisements (Home carousel).
-- Writes and analytics remain server/admin (service role) only.

begin;

drop policy if exists advertisements_authenticated_select_active on public.advertisements;
create policy advertisements_authenticated_select_active
  on public.advertisements
  for select
  to authenticated
  using (
    is_active = true
    and (start_date is null or start_date <= now())
    and (end_date is null or end_date >= now())
  );

commit;
