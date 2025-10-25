-- Activer RLS
alter table profiles enable row level security;
alter table vendors enable row level security;
alter table items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table courier_locations enable row level security;

-- Profils : chaque user voit son profil
create policy "select own profile" on profiles for select using (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- Vendors : visible à tous, modifiable par le propriétaire ou admin
create policy "vendors read" on vendors for select using (true);
create policy "vendors write" on vendors for insert with check (exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('vendeur','admin')));
create policy "vendors update" on vendors for update using (owner = auth.uid() or exists(select 1 from profiles p where p.id=auth.uid() and p.role='admin'));

-- Items : lecture publique, écriture par owner du vendor
create policy "items read" on items for select using (true);
create policy "items write" on items for insert with check (exists(select 1 from vendors v where v.id=vendor_id and (v.owner = auth.uid())));
create policy "items update" on items for update using (exists(select 1 from vendors v where v.id=vendor_id and (v.owner = auth.uid())));

-- Orders : lecture par client, vendeur lié, livreur assigné; écriture par chacun selon rôle
create policy "orders read" on orders for select using (
  client_id = auth.uid() or courier_id = auth.uid() or exists(select 1 from vendors v where v.id = orders.vendor_id and v.owner = auth.uid())
);
create policy "orders insert client" on orders for insert with check (client_id = auth.uid());
create policy "orders update roles" on orders for update using (
  client_id = auth.uid() or courier_id = auth.uid() or exists(select 1 from vendors v where v.id = orders.vendor_id and v.owner = auth.uid())
);

-- Order items : readable si on voit la commande
create policy "order_items read" on order_items for select using (exists(select 1 from orders o where o.id=order_id and (o.client_id=auth.uid() or o.courier_id=auth.uid() or exists(select 1 from vendors v where v.id=o.vendor_id and v.owner=auth.uid()))));

-- Courier locations : lecture par vendor lié et admin; écriture par le livreur
create policy "courier_locations read" on courier_locations for select using (
  exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('vendeur','admin','livreur'))
);
create policy "courier_locations upsert" on courier_locations for insert with check (courier_id = auth.uid());
create policy "courier_locations update" on courier_locations for update using (courier_id = auth.uid());
