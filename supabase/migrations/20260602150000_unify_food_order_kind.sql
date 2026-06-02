-- Phase 2 / S0-D: canonical kind for legacy food orders created with type = 'food'.

begin;

update public.orders
set kind = 'food'
where type = 'food'
  and kind is null;

commit;
