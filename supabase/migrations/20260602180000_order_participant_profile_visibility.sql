-- v2.1: schema-aware order participants, profiles/restaurant_profiles RLS,
-- avatars storage (replace all avatars policies; legacy menu/ read-only).
-- Prod note: courier_id may be absent on orders — not referenced statically.

begin;

-- ---------------------------------------------------------------------------
-- 1) order_participant_ids — only columns that exist in public.orders
-- ---------------------------------------------------------------------------

create or replace function public.order_participant_ids(p_order_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[] := array[]::text[];
  v_sql text;
begin
  if p_order_id is null then
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'client_id'
  ) then
    v_parts := v_parts || array[
      'select o.client_id as uid from public.orders o where o.id = $1 and o.client_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'client_user_id'
  ) then
    v_parts := v_parts || array[
      'select o.client_user_id as uid from public.orders o where o.id = $1 and o.client_user_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id'
  ) then
    v_parts := v_parts || array[
      'select o.user_id as uid from public.orders o where o.id = $1 and o.user_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'created_by'
  ) then
    v_parts := v_parts || array[
      'select o.created_by as uid from public.orders o where o.id = $1 and o.created_by is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'driver_id'
  ) then
    v_parts := v_parts || array[
      'select o.driver_id as uid from public.orders o where o.id = $1 and o.driver_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_user_id'
  ) then
    v_parts := v_parts || array[
      'select o.restaurant_user_id as uid from public.orders o where o.id = $1 and o.restaurant_user_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_id'
  ) then
    v_parts := v_parts || array[
      'select o.restaurant_id as uid from public.orders o where o.id = $1 and o.restaurant_id is not null'
    ];
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'courier_id'
  ) then
    v_parts := v_parts || array[
      'select o.courier_id as uid from public.orders o where o.id = $1 and o.courier_id is not null'
    ];
  end if;

  v_parts := v_parts || array[
    'select om.user_id as uid from public.order_members om where om.order_id = $1 and om.user_id is not null'
  ];

  if to_regclass('public.restaurant_profiles') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_id'
    ) then
      v_parts := v_parts || array[
        $rp1$
        select rp.user_id as uid
        from public.orders o
        join public.restaurant_profiles rp on rp.user_id = o.restaurant_id
        where o.id = $1 and rp.user_id is not null
        $rp1$
      ];
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_user_id'
    ) then
      v_parts := v_parts || array[
        $rp2$
        select rp.user_id as uid
        from public.orders o
        join public.restaurant_profiles rp on rp.user_id = o.restaurant_user_id
        where o.id = $1 and rp.user_id is not null
        $rp2$
      ];
    end if;
  end if;

  v_sql :=
    'select distinct x.uid from (' || array_to_string(v_parts, ' union all ') || ') x where x.uid is not null';

  return query execute v_sql using p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) delivery_request_participant_ids
-- ---------------------------------------------------------------------------

create or replace function public.delivery_request_participant_ids(p_request_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct participant.user_id
  from (
    select dr.created_by as user_id
    from public.delivery_requests dr
    where dr.id = p_request_id and dr.created_by is not null
    union all
    select dr.client_user_id
    from public.delivery_requests dr
    where dr.id = p_request_id and dr.client_user_id is not null
    union all
    select dr.driver_id
    from public.delivery_requests dr
    where dr.id = p_request_id and dr.driver_id is not null
  ) participant;
$$;

-- ---------------------------------------------------------------------------
-- 3) profiles_visible_to_auth_user
-- ---------------------------------------------------------------------------

create or replace function public.profiles_visible_to_auth_user(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null or p_profile_id is null then
    return false;
  end if;

  if p_profile_id = v_viewer then
    return true;
  end if;

  if exists (
    select 1
    from public.orders o
    where exists (
      select 1 from public.order_participant_ids(o.id) p where p.user_id = v_viewer
    )
    and exists (
      select 1 from public.order_participant_ids(o.id) p where p.user_id = p_profile_id
    )
  ) then
    return true;
  end if;

  if to_regclass('public.delivery_requests') is not null
     and exists (
       select 1
       from public.delivery_requests dr
       where exists (
         select 1 from public.delivery_request_participant_ids(dr.id) p where p.user_id = v_viewer
       )
       and exists (
         select 1 from public.delivery_request_participant_ids(dr.id) p where p.user_id = p_profile_id
       )
     ) then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.order_participant_ids(uuid) from public;
revoke all on function public.delivery_request_participant_ids(uuid) from public;
revoke all on function public.profiles_visible_to_auth_user(uuid) from public;
grant execute on function public.order_participant_ids(uuid) to authenticated;
grant execute on function public.delivery_request_participant_ids(uuid) to authenticated;
grant execute on function public.profiles_visible_to_auth_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) profiles RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "select own profile" on public.profiles;
drop policy if exists profiles_select_own_or_order_participant on public.profiles;

create policy profiles_select_own_or_order_participant
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.profiles_visible_to_auth_user(id)
);

drop policy if exists "update own profile" on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 5) restaurant_profiles RLS
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.restaurant_profiles') is not null then
    execute 'alter table public.restaurant_profiles enable row level security';

    execute 'drop policy if exists restaurant_profiles_select_own on public.restaurant_profiles';
    execute 'drop policy if exists restaurant_profiles_select_own_or_order_participant on public.restaurant_profiles';

    execute $policy$
      create policy restaurant_profiles_select_own_or_order_participant
      on public.restaurant_profiles
      for select
      to authenticated
      using (
        user_id = auth.uid()
        or exists (
          select 1
          from public.orders o
          where exists (
            select 1 from public.order_participant_ids(o.id) p where p.user_id = auth.uid()
          )
          and restaurant_profiles.user_id in (
            select p.user_id from public.order_participant_ids(o.id) p
          )
        )
      )
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) avatars bucket + path visibility (incl. legacy menu/{user_id}/ read-only)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update
set public = excluded.public;

create or replace function public.storage_object_matches_avatar_url(
  p_url text,
  p_object_name text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(nullif(trim(p_url), ''), '') <> ''
    and coalesce(nullif(trim(p_object_name), ''), '') <> ''
    and (
      trim(p_url) = trim(p_object_name)
      or trim(p_url) = 'avatars/' || trim(p_object_name)
      or right(trim(p_url), length(trim(p_object_name))) = trim(p_object_name)
    );
$$;

create or replace function public.avatar_storage_path_visible(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if coalesce(nullif(trim(p_object_name), ''), '') = '' then
    return false;
  end if;

  if v_viewer is not null then
    -- Standard profile folders (own + participant-matched URLs below)
    if p_object_name like ('clients/' || v_viewer::text || '/%')
       or p_object_name like ('drivers/' || v_viewer::text || '/%')
       or p_object_name like ('restaurants/' || v_viewer::text || '/%') then
      return true;
    end if;

    -- Legacy menu images: menu/{restaurant_user_id}/... (SELECT only via storage policy)
    if p_object_name like ('menu/' || v_viewer::text || '/%') then
      return true;
    end if;

    if exists (
      select 1
      from public.profiles p
      where public.profiles_visible_to_auth_user(p.id)
        and public.storage_object_matches_avatar_url(p.avatar_url, p_object_name)
    ) then
      return true;
    end if;

    if to_regclass('public.restaurant_profiles') is not null
       and exists (
         select 1
         from public.restaurant_profiles rp
         where (
           public.profiles_visible_to_auth_user(rp.user_id)
           or exists (
             select 1
             from public.orders o
             where exists (
               select 1 from public.order_participant_ids(o.id) px where px.user_id = v_viewer
             )
             and rp.user_id in (
               select px.user_id from public.order_participant_ids(o.id) px
             )
           )
         )
         and (
           public.storage_object_matches_avatar_url(rp.avatar_url, p_object_name)
           or public.storage_object_matches_avatar_url(rp.logo_url, p_object_name)
         )
       ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.storage_object_matches_avatar_url(text, text) from public;
revoke all on function public.avatar_storage_path_visible(text) from public;
grant execute on function public.storage_object_matches_avatar_url(text, text) to authenticated;
grant execute on function public.avatar_storage_path_visible(text) to authenticated;

-- Drop all existing storage.objects policies targeting avatars
do $$
declare
  r record;
begin
  for r in
    select pol.polname as policy_name
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%avatars%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%avatars%'
        or pol.polname ilike '%avatar%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', r.policy_name);
  end loop;
end $$;

create policy avatars_select_participants
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.avatar_storage_path_visible(name)
);

-- Writes: clients/, drivers/, restaurants/ only (never menu/)
create policy avatars_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (
    name like ('clients/' || auth.uid()::text || '/%')
    or name like ('drivers/' || auth.uid()::text || '/%')
    or name like ('restaurants/' || auth.uid()::text || '/%')
  )
);

create policy avatars_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (
    name like ('clients/' || auth.uid()::text || '/%')
    or name like ('drivers/' || auth.uid()::text || '/%')
    or name like ('restaurants/' || auth.uid()::text || '/%')
  )
)
with check (
  bucket_id = 'avatars'
  and (
    name like ('clients/' || auth.uid()::text || '/%')
    or name like ('drivers/' || auth.uid()::text || '/%')
    or name like ('restaurants/' || auth.uid()::text || '/%')
  )
);

create policy avatars_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (
    name like ('clients/' || auth.uid()::text || '/%')
    or name like ('drivers/' || auth.uid()::text || '/%')
    or name like ('restaurants/' || auth.uid()::text || '/%')
  )
);

commit;
