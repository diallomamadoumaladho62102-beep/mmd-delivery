-- Production financial guards: taxi_rides client financial updates + wallet_ledger immutability.

begin;

-- ---------------------------------------------------------------------------
-- taxi_rides — block client UPDATE of financial / payment fields
-- ---------------------------------------------------------------------------

create or replace function public.guard_taxi_rides_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role = 'service_role' or session_user = 'service_role' then
    return NEW;
  end if;

  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if NEW.subtotal_cents is distinct from OLD.subtotal_cents then
    raise exception 'taxi_rides_financial_update_forbidden: subtotal_cents';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'taxi_rides_financial_update_forbidden: total_cents';
  end if;
  if NEW.gross_total_cents is distinct from OLD.gross_total_cents then
    raise exception 'taxi_rides_financial_update_forbidden: gross_total_cents';
  end if;
  if NEW.discount_cents is distinct from OLD.discount_cents then
    raise exception 'taxi_rides_financial_update_forbidden: discount_cents';
  end if;
  if NEW.platform_fee_cents is distinct from OLD.platform_fee_cents then
    raise exception 'taxi_rides_financial_update_forbidden: platform_fee_cents';
  end if;
  if NEW.driver_payout_cents is distinct from OLD.driver_payout_cents then
    raise exception 'taxi_rides_financial_update_forbidden: driver_payout_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'taxi_rides_financial_update_forbidden: currency';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'taxi_rides_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_taxi_rides_client_financial_update on public.taxi_rides;
create trigger trg_guard_taxi_rides_client_financial_update
before update on public.taxi_rides
for each row execute function public.guard_taxi_rides_client_financial_update();

-- ---------------------------------------------------------------------------
-- wallet_ledger — immutable audit log (service_role writes only)
-- ---------------------------------------------------------------------------

create or replace function public.guard_wallet_ledger_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role = 'service_role' or session_user = 'service_role' then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  raise exception 'wallet_ledger_immutable';
end;
$$;

drop trigger if exists trg_guard_wallet_ledger_immutable on public.wallet_ledger;
create trigger trg_guard_wallet_ledger_immutable
before update or delete on public.wallet_ledger
for each row execute function public.guard_wallet_ledger_immutable();

commit;
