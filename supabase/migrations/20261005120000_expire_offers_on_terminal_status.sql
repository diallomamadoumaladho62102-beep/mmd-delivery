-- Expire pending driver offers when orders / delivery_requests become terminal.
-- Fixes cancelled jobs reappearing in Driver available/active lists.

begin;

create or replace function public.expire_pending_offers_on_order_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and lower(coalesce(new.status, '')) in (
       'canceled', 'cancelled', 'expired', 'rejected', 'refunded', 'delivered', 'completed'
     )
  then
    update public.driver_order_offers
    set status = 'expired',
        updated_at = now()
    where order_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expire_pending_offers_on_order_terminal on public.orders;
create trigger trg_expire_pending_offers_on_order_terminal
after update of status on public.orders
for each row
execute function public.expire_pending_offers_on_order_terminal();

create or replace function public.expire_pending_offers_on_delivery_request_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and lower(coalesce(new.status, '')) in (
       'canceled', 'cancelled', 'expired', 'rejected', 'refunded', 'delivered', 'completed'
     )
  then
    update public.delivery_request_driver_offers
    set status = 'expired',
        updated_at = now()
    where delivery_request_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expire_pending_offers_on_dr_terminal on public.delivery_requests;
create trigger trg_expire_pending_offers_on_dr_terminal
after update of status on public.delivery_requests
for each row
execute function public.expire_pending_offers_on_delivery_request_terminal();

-- One-shot cleanup of already-stale pending offers tied to terminal parents.
update public.driver_order_offers o
set status = 'expired',
    updated_at = now()
where o.status = 'pending'
  and exists (
    select 1
    from public.orders ord
    where ord.id = o.order_id
      and lower(coalesce(ord.status, '')) in (
        'canceled', 'cancelled', 'expired', 'rejected', 'refunded', 'delivered', 'completed'
      )
  );

update public.delivery_request_driver_offers o
set status = 'expired',
    updated_at = now()
where o.status = 'pending'
  and exists (
    select 1
    from public.delivery_requests dr
    where dr.id = o.delivery_request_id
      and lower(coalesce(dr.status, '')) in (
        'canceled', 'cancelled', 'expired', 'rejected', 'refunded', 'delivered', 'completed'
      )
  );

notify pgrst, 'reload schema';

commit;
