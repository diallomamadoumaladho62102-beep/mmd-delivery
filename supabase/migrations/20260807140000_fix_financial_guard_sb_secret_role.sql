-- Allow service-role writes when using new sb_secret_* keys.
-- Legacy service_role JWT set request.jwt.claim.role = 'service_role'.
-- Opaque sb_secret keys often leave that claim empty while still connecting
-- as Postgres role service_role (current_user / auth.role()).
-- Symptom: create-checkout-session fails with "Failed to set order processing".

begin;

create or replace function public.guard_orders_client_financial_update()
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
    raise exception 'orders_financial_update_forbidden: subtotal';
  end if;
  if NEW.tax is distinct from OLD.tax then
    raise exception 'orders_financial_update_forbidden: tax';
  end if;
  if NEW.total is distinct from OLD.total then
    raise exception 'orders_financial_update_forbidden: total';
  end if;
  if NEW.grand_total is distinct from OLD.grand_total then
    raise exception 'orders_financial_update_forbidden: grand_total';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'orders_financial_update_forbidden: total_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'orders_financial_update_forbidden: currency';
  end if;
  if NEW.delivery_fee is distinct from OLD.delivery_fee then
    raise exception 'orders_financial_update_forbidden: delivery_fee';
  end if;
  if NEW.service_fee is distinct from OLD.service_fee then
    raise exception 'orders_financial_update_forbidden: service_fee';
  end if;
  if NEW.service_fee_cents is distinct from OLD.service_fee_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_cents';
  end if;
  if NEW.service_fee_pct is distinct from OLD.service_fee_pct then
    raise exception 'orders_financial_update_forbidden: service_fee_pct';
  end if;
  if NEW.service_fee_enabled is distinct from OLD.service_fee_enabled then
    raise exception 'orders_financial_update_forbidden: service_fee_enabled';
  end if;
  if NEW.service_fee_fixed_cents is distinct from OLD.service_fee_fixed_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_fixed_cents';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'orders_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

commit;
