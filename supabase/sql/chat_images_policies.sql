-- =====================================================================
-- MMD Delivery - Storage policies pour bucket `chat-images`
-- =====================================================================

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('chat-images', 'chat-images', false)
  on conflict (id) do update set public = false;
exception when others then
  null;
end$$;

drop policy if exists chat_images_select_min on storage.objects;
create policy chat_images_select_min
on storage.objects for select
to authenticated
using (bucket_id = 'chat-images');

drop policy if exists chat_images_insert_min on storage.objects;
create policy chat_images_insert_min
on storage.objects for insert
to authenticated
with check (bucket_id = 'chat-images');

-- Suppression : faite via la RPC delete_order_message
