-- P0: Close food payment trust boundary — block client-side order amount injection.
-- Food orders must be created via server API (service role), not direct authenticated INSERT.

begin;

do $food_orders_rls$
begin
  if to_regclass('public.orders') is null then
    return;
  end if;

  alter table public.orders enable row level security;

  drop policy if exists "orders insert client" on public.orders;
  drop policy if exists orders_insert_client on public.orders;
end
$food_orders_rls$;

commit;
