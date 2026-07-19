-- Phase 4 restaurant production hardening:
-- - browse/write RLS for restaurant_profiles
-- - menu_categories RLS
-- - restaurant-menu storage owner writes
-- - is_busy + cover_image_url
-- - stock_qty optional on restaurant_items

begin;

alter table public.restaurant_profiles
  add column if not exists is_busy boolean not null default false;

alter table public.restaurant_profiles
  add column if not exists cover_image_url text;

alter table public.restaurant_profiles
  add column if not exists status text;

alter table public.restaurant_profiles
  add column if not exists user_id uuid;

alter table public.restaurant_items
  add column if not exists stock_qty integer;

alter table public.restaurant_items
  add column if not exists options_json jsonb not null default '[]'::jsonb;

comment on column public.restaurant_profiles.is_busy is
  'Manual busy mode: restaurant remains open but should not accept new orders.';
comment on column public.restaurant_profiles.cover_image_url is
  'Optional cover/banner image URL for restaurant profile.';
comment on column public.restaurant_items.stock_qty is
  'Optional remaining stock. NULL means unlimited; 0 means unavailable.';
comment on column public.restaurant_items.options_json is
  'Optional addon/option groups for the menu item (JSON array).';

-- ---------------------------------------------------------------------------
-- restaurant_profiles RLS: own write + public browse of approved restaurants
-- ---------------------------------------------------------------------------

alter table public.restaurant_profiles enable row level security;

drop policy if exists restaurant_profiles_select_approved_public on public.restaurant_profiles;
create policy restaurant_profiles_select_approved_public
  on public.restaurant_profiles
  for select
  to anon, authenticated
  using (
    lower(coalesce(status, '')) = 'approved'
  );

drop policy if exists restaurant_profiles_select_own on public.restaurant_profiles;
create policy restaurant_profiles_select_own
  on public.restaurant_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists restaurant_profiles_insert_own on public.restaurant_profiles;
create policy restaurant_profiles_insert_own
  on public.restaurant_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists restaurant_profiles_update_own on public.restaurant_profiles;
create policy restaurant_profiles_update_own
  on public.restaurant_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Prevent restaurants from self-approving via client update.
create or replace function public.guard_restaurant_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'UPDATE' then
      -- Keep admin-controlled operational status unless currently pending/incomplete/rejected.
      if lower(coalesce(old.status, '')) in ('approved', 'suspended', 'disabled') then
        new.status := old.status;
      else
        -- Allow pending/rejected profiles to stay pending after edits.
        if lower(coalesce(new.status, '')) = 'approved' then
          new.status := 'pending';
        end if;
      end if;
    else
      if lower(coalesce(new.status, '')) = 'approved' then
        new.status := 'pending';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_restaurant_profile_self_update on public.restaurant_profiles;
create trigger trg_guard_restaurant_profile_self_update
  before insert or update on public.restaurant_profiles
  for each row
  execute function public.guard_restaurant_profile_self_update();

-- ---------------------------------------------------------------------------
-- menu_categories: ensure table + RLS
-- ---------------------------------------------------------------------------

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_menu_categories_restaurant_position
  on public.menu_categories (restaurant_id, position, created_at);

alter table public.menu_categories enable row level security;

drop policy if exists menu_categories_select_own_or_public on public.menu_categories;
create policy menu_categories_select_own_or_public
  on public.menu_categories
  for select
  to anon, authenticated
  using (
    restaurant_id = auth.uid()
    or exists (
      select 1
      from public.restaurant_profiles rp
      where rp.user_id = menu_categories.restaurant_id
        and lower(coalesce(rp.status, '')) = 'approved'
    )
  );

drop policy if exists menu_categories_insert_own on public.menu_categories;
create policy menu_categories_insert_own
  on public.menu_categories
  for insert
  to authenticated
  with check (restaurant_id = auth.uid());

drop policy if exists menu_categories_update_own on public.menu_categories;
create policy menu_categories_update_own
  on public.menu_categories
  for update
  to authenticated
  using (restaurant_id = auth.uid())
  with check (restaurant_id = auth.uid());

drop policy if exists menu_categories_delete_own on public.menu_categories;
create policy menu_categories_delete_own
  on public.menu_categories
  for delete
  to authenticated
  using (restaurant_id = auth.uid());

-- ---------------------------------------------------------------------------
-- storage: restaurant-menu owner writes under restaurants/{uid}/...
-- ---------------------------------------------------------------------------

drop policy if exists "restaurant-menu owner insert" on storage.objects;
create policy "restaurant-menu owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-menu'
    and (storage.foldername(name))[1] = 'restaurants'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "restaurant-menu owner update" on storage.objects;
create policy "restaurant-menu owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'restaurant-menu'
    and (storage.foldername(name))[1] = 'restaurants'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'restaurant-menu'
    and (storage.foldername(name))[1] = 'restaurants'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "restaurant-menu owner delete" on storage.objects;
create policy "restaurant-menu owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'restaurant-menu'
    and (storage.foldername(name))[1] = 'restaurants'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

commit;
