-- Taxi business member invites — API/service_role access only

begin;

create table if not exists public.taxi_business_member_invites (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null
    references public.taxi_business_accounts (id) on delete cascade,
  email text not null,
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'admin')),
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create index if not exists taxi_business_member_invites_account_idx
  on public.taxi_business_member_invites (business_account_id, created_at desc);

create index if not exists taxi_business_member_invites_email_idx
  on public.taxi_business_member_invites (lower(email), status);

create unique index if not exists taxi_business_member_invites_pending_email_uq
  on public.taxi_business_member_invites (business_account_id, lower(email))
  where status = 'pending';

alter table public.taxi_business_member_invites enable row level security;

drop policy if exists taxi_business_member_invites_deny_all on public.taxi_business_member_invites;
create policy taxi_business_member_invites_deny_all
  on public.taxi_business_member_invites
  for all
  to authenticated, anon
  using (false)
  with check (false);

revoke all on table public.taxi_business_member_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.taxi_business_member_invites to service_role;

commit;
