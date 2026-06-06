-- Admin governance P0: active staff enforcement, founder flag, account helpers.

begin;

-- ---------------------------------------------------------------------------
-- 1) Staff must have account_status = active
-- ---------------------------------------------------------------------------

create or replace function public.is_staff_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(trim(coalesce(p.role::text, ''))) in (
        'admin', 'ops', 'finance', 'support', 'review'
      )
      and coalesce(p.account_status, 'active') = 'active'
  );
$$;

create or replace function public.is_super_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(trim(coalesce(p.role::text, ''))) = 'admin'
      and coalesce(p.account_status, 'active') = 'active'
  );
$$;

create or replace function public.is_account_active(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.account_status = 'active'
      from public.profiles p
      where p.id = p_user_id
    ),
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Founder flag (Super Admin fondateur — immutable via governance API)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_founder boolean not null default false;

do $$
declare
  v_founder_id uuid;
begin
  if not exists (select 1 from public.profiles where is_founder = true) then
    select id into v_founder_id
    from public.profiles
    where lower(trim(coalesce(role::text, ''))) = 'admin'
    order by created_at asc
    limit 1;

    if v_founder_id is not null then
      update public.profiles
      set is_founder = true
      where id = v_founder_id;
    end if;
  end if;
end $$;

create index if not exists profiles_is_founder_idx
  on public.profiles (is_founder)
  where is_founder = true;

commit;
