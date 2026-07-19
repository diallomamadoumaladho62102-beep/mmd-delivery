-- Phase 2 / S0-D: canonical kind for legacy food orders created with type = 'food'.
-- Defensive for empty-DB resets: early orders bootstrap may lack type/kind columns.

begin;

do $unify_food_order_kind$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'type'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'kind'
  ) then
    update public.orders
    set kind = 'food'
    where type = 'food'
      and kind is null;
  end if;
end;
$unify_food_order_kind$;

commit;
