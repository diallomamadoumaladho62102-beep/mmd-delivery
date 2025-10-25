create or replace function public.ensure_member_on_order()
returns trigger language plpgsql as $$
begin
  if NEW.client_id is not null then
    insert into order_members (order_id, user_id, role)
    values (NEW.id, NEW.client_id, 'client')
    on conflict (order_id, user_id) do nothing;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_ensure_member_on_order on public.orders;
create trigger trg_ensure_member_on_order
after insert on public.orders
for each row execute function public.ensure_member_on_order();
