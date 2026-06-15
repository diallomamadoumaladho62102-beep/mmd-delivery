-- Final production hardening P0/P1:
-- - Block client INSERT on delivery_requests and taxi_rides
-- - Block client UPDATE of financial fields on orders and delivery_requests

begin;

-- ---------------------------------------------------------------------------
-- A) delivery_requests — no direct client INSERT
-- ---------------------------------------------------------------------------

do $delivery_rls$
begin
  if to_regclass('public.delivery_requests') is null then
    return;
  end if;

  alter table public.delivery_requests enable row level security;

  drop policy if exists delivery_requests_insert_client on public.delivery_requests;
  drop policy if exists "delivery_requests insert client" on public.delivery_requests;
end
$delivery_rls$;

-- ---------------------------------------------------------------------------
-- B) taxi_rides — no direct client INSERT
-- ---------------------------------------------------------------------------

do $taxi_rls$
begin
  if to_regclass('public.taxi_rides') is null then
    return;
  end if;

  alter table public.taxi_rides enable row level security;

  drop policy if exists taxi_rides_insert_client on public.taxi_rides;
end
$taxi_rls$;

-- ---------------------------------------------------------------------------
-- C) orders — block client UPDATE of financial / payment fields
-- ---------------------------------------------------------------------------

create or replace function public.guard_orders_client_financial_update()
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
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'orders_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_orders_client_financial_update on public.orders;
create trigger trg_guard_orders_client_financial_update
before update on public.orders
for each row execute function public.guard_orders_client_financial_update();

-- ---------------------------------------------------------------------------
-- D) delivery_requests — block client UPDATE of financial / payment fields
-- ---------------------------------------------------------------------------

create or replace function public.guard_delivery_requests_client_financial_update()
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
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'delivery_requests_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_delivery_requests_client_financial_update on public.delivery_requests;
create trigger trg_guard_delivery_requests_client_financial_update
before update on public.delivery_requests
for each row execute function public.guard_delivery_requests_client_financial_update();

-- Drop legacy permissive orders UPDATE policy if present
drop policy if exists "orders update roles" on public.orders;
drop policy if exists orders_update_roles on public.orders;

commit;
