-- App RPCs (confirm_order_pickup) write status='picked_up', but production
-- order_status_values historically omitted it, blocking pickup transitions.

insert into public.order_status_values (status)
values ('picked_up')
on conflict (status) do nothing;
