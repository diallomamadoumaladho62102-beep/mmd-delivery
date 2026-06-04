-- delivery-proofs bucket + RLS (driver upload, participants read)

begin;

insert into storage.buckets (id, name, public)
values ('delivery-proofs', 'delivery-proofs', false)
on conflict (id) do update
set public = excluded.public;

create or replace function public.delivery_proof_order_id_from_path(p_object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(trim(p_object_name), '/', 1), '')::uuid;
$$;

create or replace function public.delivery_proof_driver_id_from_path(p_object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(trim(p_object_name), '/', 2), '')::uuid;
$$;

create or replace function public.user_is_assigned_driver_for_proof(p_order_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_order_id is null or p_user_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.driver_id = p_user_id
  ) then
    return true;
  end if;

  if to_regclass('public.delivery_requests') is not null
     and exists (
       select 1
       from public.delivery_requests dr
       where dr.id = p_order_id
         and dr.driver_id = p_user_id
     ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.user_can_read_delivery_proof(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_order_id uuid;
begin
  if v_viewer is null then
    return false;
  end if;

  v_order_id := public.delivery_proof_order_id_from_path(p_object_name);
  if v_order_id is null then
    return false;
  end if;

  if public.delivery_proof_driver_id_from_path(p_object_name) = v_viewer then
    return true;
  end if;

  if exists (
    select 1
    from public.order_participant_ids(v_order_id) p
    where p.user_id = v_viewer
  ) then
    return true;
  end if;

  if to_regclass('public.delivery_requests') is not null
     and exists (
       select 1
       from public.delivery_request_participant_ids(v_order_id) p
       where p.user_id = v_viewer
     ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.user_can_upload_delivery_proof(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_order_id uuid;
  v_path_driver uuid;
begin
  if v_viewer is null then
    return false;
  end if;

  v_order_id := public.delivery_proof_order_id_from_path(p_object_name);
  v_path_driver := public.delivery_proof_driver_id_from_path(p_object_name);

  if v_order_id is null or v_path_driver is null or v_path_driver <> v_viewer then
    return false;
  end if;

  return public.user_is_assigned_driver_for_proof(v_order_id, v_viewer);
end;
$$;

drop policy if exists delivery_proofs_insert_assigned_driver on storage.objects;
create policy delivery_proofs_insert_assigned_driver
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and public.user_can_upload_delivery_proof(name)
  );

drop policy if exists delivery_proofs_select_participants on storage.objects;
create policy delivery_proofs_select_participants
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and public.user_can_read_delivery_proof(name)
  );

drop policy if exists delivery_proofs_update_assigned_driver on storage.objects;
create policy delivery_proofs_update_assigned_driver
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and public.user_can_upload_delivery_proof(name)
  )
  with check (
    bucket_id = 'delivery-proofs'
    and public.user_can_upload_delivery_proof(name)
  );

drop policy if exists delivery_proofs_delete_assigned_driver on storage.objects;
create policy delivery_proofs_delete_assigned_driver
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and public.user_can_upload_delivery_proof(name)
  );

revoke all on function public.delivery_proof_order_id_from_path(text) from public;
revoke all on function public.delivery_proof_driver_id_from_path(text) from public;
revoke all on function public.user_is_assigned_driver_for_proof(uuid, uuid) from public;
revoke all on function public.user_can_read_delivery_proof(text) from public;
revoke all on function public.user_can_upload_delivery_proof(text) from public;

grant execute on function public.delivery_proof_order_id_from_path(text) to authenticated;
grant execute on function public.delivery_proof_driver_id_from_path(text) to authenticated;
grant execute on function public.user_is_assigned_driver_for_proof(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_delivery_proof(text) to authenticated;
grant execute on function public.user_can_upload_delivery_proof(text) to authenticated;

commit;
