-- MENU: restaurant-menu => public read
drop policy if exists "public read restaurant-menu" on storage.objects;

create policy "public read restaurant-menu"
on storage.objects for select
to public
using (bucket_id = 'restaurant-menu');


-- CHAT IMAGES: chat-images => read/insert only if order member
drop policy if exists "chat-images read if order member" on storage.objects;
drop policy if exists "chat-images insert if order member" on storage.objects;

create policy "chat-images read if order member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-images'
  and exists (
    select 1
    from public.order_members om
    where om.user_id = auth.uid()
      and om.order_id::text = split_part(name, '/', 2)
  )
);

create policy "chat-images insert if order member"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-images'
  and exists (
    select 1
    from public.order_members om
    where om.user_id = auth.uid()
      and om.order_id::text = split_part(name, '/', 2)
  )
);


-- CHAT UPLOADS: chat-uploads => read/insert only if order member
drop policy if exists "chat-uploads read if order member" on storage.objects;
drop policy if exists "chat-uploads insert if order member" on storage.objects;

create policy "chat-uploads read if order member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-uploads'
  and exists (
    select 1
    from public.order_members om
    where om.user_id = auth.uid()
      and om.order_id::text = split_part(name, '/', 2)
  )
);

create policy "chat-uploads insert if order member"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-uploads'
  and exists (
    select 1
    from public.order_members om
    where om.user_id = auth.uid()
      and om.order_id::text = split_part(name, '/', 2)
  )
);
