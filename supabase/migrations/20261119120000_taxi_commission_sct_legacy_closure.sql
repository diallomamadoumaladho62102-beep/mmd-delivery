-- Taxi SCT historical closure — closes ONE unpaid commission ($5.77 / 577¢) as legacy_closed
-- without inventing a Transfer. Historical write-off only (not a payment).
-- Does NOT modify Stripe, taxi_rides, driver_paid_out, or driver_transfer_id.
-- Timestamp is migration order after 20261118120000 (not civil date).
--
-- Idempotent: re-run updates 0 rows (sct_closure_status is null filter) and still passes
-- when the target is already correctly legacy_closed.

begin;

-- ---------------------------------------------------------------------------
-- 1) Schema: closure is historical write-off, NOT a payment
-- ---------------------------------------------------------------------------
alter table public.taxi_commissions
  add column if not exists sct_closure_status text;

alter table public.taxi_commissions
  add column if not exists sct_closure_reason text;

alter table public.taxi_commissions
  add column if not exists sct_closed_at timestamptz;

alter table public.taxi_commissions
  drop constraint if exists taxi_commissions_sct_closure_status_check;

alter table public.taxi_commissions
  add constraint taxi_commissions_sct_closure_status_check
  check (
    sct_closure_status is null
    or sct_closure_status in ('legacy_closed', 'reconciled')
  );

comment on column public.taxi_commissions.sct_closure_status is
  'Historical SCT closure only (legacy_closed|reconciled). NULL = open. Never implies Stripe Transfer or driver paid.';

comment on column public.taxi_commissions.sct_closure_reason is
  'Audit reason for historical SCT write-off; not a payment reference.';

comment on column public.taxi_commissions.sct_closed_at is
  'When historical SCT was closed without Transfer.';

create index if not exists taxi_commissions_sct_closure_open_idx
  on public.taxi_commissions (driver_transfer_id, sct_closure_status)
  where driver_transfer_id is null and sct_closure_status is null;

-- ---------------------------------------------------------------------------
-- 2) Freeze refresh_taxi_commissions when historically closed
-- ---------------------------------------------------------------------------
create or replace function public.refresh_taxi_commissions(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_existing public.taxi_commissions%rowtype;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  select *
  into v_existing
  from public.taxi_commissions
  where taxi_ride_id = p_ride_id;

  if found and (
    coalesce(v_existing.driver_paid_out, false) = true
    or nullif(btrim(coalesce(v_existing.driver_transfer_id, '')), '') is not null
    or coalesce(v_existing.sct_closure_status, '') in ('legacy_closed', 'reconciled')
  ) then
    return jsonb_build_object(
      'ok', true,
      'frozen', true,
      'taxi_ride_id', p_ride_id,
      'driver_cents', v_existing.driver_cents,
      'platform_cents', v_existing.platform_cents,
      'sct_closure_status', v_existing.sct_closure_status,
      'message', 'commission_frozen_after_payout_or_legacy_closure'
    );
  end if;

  insert into public.taxi_commissions (
    taxi_ride_id,
    currency,
    total_cents,
    platform_cents,
    driver_cents
  )
  values (
    v_ride.id,
    coalesce(v_ride.currency, 'USD'),
    v_ride.total_cents,
    v_ride.platform_fee_cents,
    v_ride.driver_payout_cents
  )
  on conflict (taxi_ride_id) do update
    set
      currency = excluded.currency,
      total_cents = excluded.total_cents,
      platform_cents = excluded.platform_cents,
      driver_cents = excluded.driver_cents,
      updated_at = now()
  where
    coalesce(public.taxi_commissions.driver_paid_out, false) = false
    and nullif(btrim(coalesce(public.taxi_commissions.driver_transfer_id, '')), '') is null
    and coalesce(public.taxi_commissions.sct_closure_status, '') not in ('legacy_closed', 'reconciled');

  return jsonb_build_object(
    'ok', true,
    'frozen', false,
    'taxi_ride_id', p_ride_id
  );
end;
$$;

comment on function public.refresh_taxi_commissions(uuid) is
  'Upserts taxi_commissions from ride snapshot; refuses overwrite after payout/transfer/legacy_closed.';

-- ---------------------------------------------------------------------------
-- 3) Scoped DML + ROW_COUNT guard (idempotent)
--    First run: UPDATE 1. Re-run: UPDATE 0 + already legacy_closed → OK.
--    Any other ROW_COUNT / missing closed target → EXCEPTION (aborts transaction).
-- ---------------------------------------------------------------------------
do $$
declare
  v_updated int;
  v_closed int;
  v_target_still_open boolean;
begin
  update public.taxi_commissions
  set
    sct_closure_status = 'legacy_closed',
    sct_closure_reason = 'historical_write_off_platform_balance_insufficient_2026-07',
    sct_closed_at = now(),
    updated_at = now()
  where id = 'de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3'
    and taxi_ride_id = '8ad69f07-2f12-4a3e-9579-7a6a8333765a'
    and driver_cents = 577
    and driver_transfer_id is null
    and coalesce(driver_paid_out, false) = false
    and sct_closure_status is null;

  get diagnostics v_updated = row_count;

  if v_updated > 1 then
    raise exception
      'taxi_sct_legacy_closure: updated % rows (hard max 1)',
      v_updated;
  end if;

  if v_updated = 0 then
    -- Idempotent re-apply: target must already be correctly closed.
    select count(*) into v_closed
    from public.taxi_commissions
    where id = 'de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3'
      and taxi_ride_id = '8ad69f07-2f12-4a3e-9579-7a6a8333765a'
      and driver_cents = 577
      and driver_transfer_id is null
      and coalesce(driver_paid_out, false) = false
      and sct_closure_status = 'legacy_closed';

    if v_closed <> 1 then
      raise exception
        'taxi_sct_legacy_closure: UPDATE matched 0 and target is not already legacy_closed (found %)',
        v_closed;
    end if;
  else
    -- First close: must be exactly 1 updated and final state correct.
    if v_updated <> 1 then
      raise exception
        'taxi_sct_legacy_closure: unexpected ROW_COUNT %',
        v_updated;
    end if;
  end if;

  select count(*) into v_closed
  from public.taxi_commissions
  where id = 'de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3'
    and taxi_ride_id = '8ad69f07-2f12-4a3e-9579-7a6a8333765a'
    and sct_closure_status = 'legacy_closed'
    and driver_transfer_id is null
    and coalesce(driver_paid_out, false) = false
    and driver_cents = 577;

  if v_closed <> 1 then
    raise exception
      'taxi_sct_legacy_closure: expected exactly 1 correctly closed target row, found %',
      v_closed;
  end if;

  select exists (
    select 1
    from public.taxi_commissions
    where id = 'de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3'
      and sct_closure_status is null
  ) into v_target_still_open;

  if v_target_still_open then
    raise exception 'taxi_sct_legacy_closure: target row still open after update';
  end if;
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual — do not run with forward migration)
-- ---------------------------------------------------------------------------
-- begin;
-- update public.taxi_commissions
-- set
--   sct_closure_status = null,
--   sct_closure_reason = null,
--   sct_closed_at = null,
--   updated_at = now()
-- where id = 'de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3'
--   and sct_closure_status = 'legacy_closed';
-- -- Optional: restore prior refresh_taxi_commissions from
-- -- 20260805130000_freeze_taxi_commissions_after_payout.sql if full schema rollback needed.
-- commit;
