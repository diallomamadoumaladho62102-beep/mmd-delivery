-- Driver inbox: speed up latest-message lookups per order
create index if not exists order_messages_order_id_created_at_idx
  on public.order_messages (order_id, created_at desc);
