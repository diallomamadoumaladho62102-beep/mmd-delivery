-- One auth user = one public.profiles row.
-- A second INSERT for an existing id updates non-privileged fields and
-- does not create another row. Authenticated clients cannot choose another id.
-- client_profiles stays a delivery-detail row (one per user). It is not a
-- second canonical profile: identity fields are copied onto public.profiles.
-- Does not update or delete existing user rows.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%auth.users%'
  ) then
    alter table public.profiles
      add constraint profiles_id_auth_users_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end;
$$;

create or replace function public.profiles_insert_idempotent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if auth.uid() is null or new.id is distinct from auth.uid() then
      raise exception 'profile_id_must_match_auth_uid'
        using errcode = '42501';
    end if;
  end if;

  if exists (select 1 from public.profiles where id = new.id) then
    update public.profiles as p
    set
      full_name = coalesce(nullif(btrim(new.full_name), ''), p.full_name),
      phone = coalesce(nullif(btrim(new.phone), ''), p.phone),
      email = case
        when nullif(btrim(new.email), '') is null then p.email
        when lower(btrim(new.email)) = lower(coalesce(p.email, '')) then p.email
        when not exists (
          select 1
          from public.profiles as other
          where other.id <> p.id
            and lower(other.email) = lower(btrim(new.email))
        ) then btrim(new.email)
        else p.email
      end,
      avatar_url = coalesce(nullif(btrim(new.avatar_url), ''), p.avatar_url),
      client_address = coalesce(nullif(btrim(new.client_address), ''), p.client_address),
      client_city = coalesce(nullif(btrim(new.client_city), ''), p.client_city),
      client_state = coalesce(nullif(btrim(new.client_state), ''), p.client_state),
      client_zip = coalesce(nullif(btrim(new.client_zip), ''), p.client_zip),
      updated_at = now()
    where p.id = new.id
      and (
        coalesce(auth.role(), '') in ('service_role', 'supabase_auth_admin')
        or auth.uid() = new.id
        or auth.uid() is null
      );

    return null;
  end if;

  return new;
end;
$$;

comment on function public.profiles_insert_idempotent() is
  'Second profile insert for the same auth id updates allowed fields and is skipped. Role, founder, and account status stay untouched.';

drop trigger if exists trg_a_profiles_insert_idempotent on public.profiles;
create trigger trg_a_profiles_insert_idempotent
before insert on public.profiles
for each row
execute function public.profiles_insert_idempotent();

create or replace function public.client_profiles_bind_canonical()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if auth.uid() is null or new.user_id is distinct from auth.uid() then
      raise exception 'client_profile_user_must_match_auth_uid'
        using errcode = '42501';
    end if;
  end if;

  update public.profiles as p
  set
    full_name = coalesce(nullif(btrim(new.full_name), ''), p.full_name),
    phone = coalesce(nullif(btrim(new.phone), ''), p.phone),
    avatar_url = coalesce(nullif(btrim(new.avatar_url), ''), p.avatar_url),
    client_address = coalesce(
      nullif(btrim(coalesce(new.address_line1, new.address, new.default_address)), ''),
      p.client_address
    ),
    client_city = coalesce(nullif(btrim(new.city), ''), p.client_city),
    client_state = coalesce(nullif(btrim(new.state), ''), p.client_state),
    client_zip = coalesce(nullif(btrim(coalesce(new.postal_code, new.zip)), ''), p.client_zip),
    updated_at = now()
  where p.id = new.user_id;

  return new;
end;
$$;

comment on function public.client_profiles_bind_canonical() is
  'client_profiles is one delivery-detail row per auth user. Identity fields are copied onto the canonical public.profiles row. This does not insert a second profile.';

drop trigger if exists trg_client_profiles_bind_canonical on public.client_profiles;
create trigger trg_client_profiles_bind_canonical
before insert or update on public.client_profiles
for each row
execute function public.client_profiles_bind_canonical();

create or replace function public.diagnose_canonical_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'user_id', p_user_id,
    'auth_user', (
      select jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'created_at', u.created_at,
        'role_metadata', u.raw_user_meta_data ->> 'role'
      )
      from auth.users as u
      where u.id = p_user_id
    ),
    'profiles', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'role', p.role,
            'email', p.email,
            'created_at', p.created_at
          )
        ),
        '[]'::jsonb
      )
      from public.profiles as p
      where p.id = p_user_id
    ),
    'profile_count', (select count(*) from public.profiles as p where p.id = p_user_id),
    'client_profiles', (select count(*) from public.client_profiles as c where c.user_id = p_user_id),
    'driver_profiles', (select count(*) from public.driver_profiles as d where d.user_id = p_user_id),
    'restaurant_profiles', (select count(*) from public.restaurant_profiles as r where r.user_id = p_user_id),
    'sellers', (select count(*) from public.sellers as s where s.user_id = p_user_id),
    'identities', (select count(*) from auth.identities as i where i.user_id = p_user_id),
    'sessions', (select count(*) from auth.sessions as s where s.user_id = p_user_id)
  );
end;
$$;

comment on function public.diagnose_canonical_profile(uuid) is
  'Read-only profile inventory for one auth user. Does not modify data.';

revoke all on function public.diagnose_canonical_profile(uuid) from public;
revoke all on function public.diagnose_canonical_profile(uuid) from anon;
revoke all on function public.diagnose_canonical_profile(uuid) from authenticated;
grant execute on function public.diagnose_canonical_profile(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
