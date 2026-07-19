-- Allow service-role writes when using new sb_secret_* keys.
-- Same fix as 20260807140000 for orders — delivery_requests / taxi_rides
-- still only checked request.jwt.claim.role + session_user, which opaque
-- sb_secret keys often leave empty while still connecting as service_role.
-- Symptom: create-delivery-request-checkout-session fails with
-- "Failed to set delivery request processing"
-- (delivery_requests_financial_update_forbidden: payment_status).

begin;

create or replace function public.guard_delivery_requests_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_auth_role text := '';
begin
  begin
    v_auth_role := coalesce(auth.role(), '');
  exception
    when others then
      v_auth_role := '';
  end;

  if v_jwt_role = 'service_role'
     or session_user::text = 'service_role'
     or current_user::text = 'service_role'
     or v_auth_role = 'service_role'
  then
    return NEW;
  end if;

  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if NEW.subtotal is distinct from OLD.subtotal then
    raise exception 'delivery_requests_financial_update_forbidden: subtotal';
  end if;
  if NEW.tax is distinct from OLD.tax then
    raise exception 'delivery_requests_financial_update_forbidden: tax';
  end if;
  if NEW.total is distinct from OLD.total then
    raise exception 'delivery_requests_financial_update_forbidden: total';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'delivery_requests_financial_update_forbidden: total_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'delivery_requests_financial_update_forbidden: currency';
  end if;
  if NEW.delivery_fee is distinct from OLD.delivery_fee then
    raise exception 'delivery_requests_financial_update_forbidden: delivery_fee';
  end if;
  if NEW.service_fee is distinct from OLD.service_fee then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee';
  end if;
  if NEW.service_fee_cents is distinct from OLD.service_fee_cents then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_cents';
  end if;
  if NEW.service_fee_pct is distinct from OLD.service_fee_pct then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_pct';
  end if;
  if NEW.service_fee_enabled is distinct from OLD.service_fee_enabled then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_enabled';
  end if;
  if NEW.service_fee_fixed_cents is distinct from OLD.service_fee_fixed_cents then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_fixed_cents';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'delivery_requests_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

create or replace function public.guard_taxi_rides_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_auth_role text := '';
begin
  begin
    v_auth_role := coalesce(auth.role(), '');
  exception
    when others then
      v_auth_role := '';
  end;

  if v_jwt_role = 'service_role'
     or session_user::text = 'service_role'
     or current_user::text = 'service_role'
     or v_auth_role = 'service_role'
  then
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

commit;
