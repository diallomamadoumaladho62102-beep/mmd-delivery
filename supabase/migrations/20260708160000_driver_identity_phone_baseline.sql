-- Store verified phone baseline so is_online toggles do not re-trigger phone_change.
-- Table is created later in 20260726120000; no-op on empty DB until then.

begin;

do $mig$
begin
  if to_regclass('public.driver_identity_state') is null then
    raise notice 'driver_identity_state missing — skip phone baseline (created later)';
    return;
  end if;

  alter table public.driver_identity_state
    add column if not exists last_verified_phone text;

  update public.driver_identity_state dis
  set last_verified_phone = dp.phone
  from public.driver_profiles dp
  where dp.user_id = dis.driver_id
    and dis.last_verified_at is not null
    and dis.last_verified_phone is null
    and coalesce(dp.phone, '') <> '';
end;
$mig$;

commit;
