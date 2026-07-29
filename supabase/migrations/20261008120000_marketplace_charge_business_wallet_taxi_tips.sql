-- Marketplace: durable charge id for source_transaction SCTs.
-- Business: Stripe Connect + ledger wallet (pay-in spend + cash-out).
-- Taxi: tip columns mirroring food tip PaymentIntent + SCT model.

begin;

-- ---------------------------------------------------------------------------
-- 1) Marketplace seller_orders.stripe_charge_id
-- ---------------------------------------------------------------------------
alter table if exists public.seller_orders
  add column if not exists stripe_charge_id text;

create index if not exists seller_orders_stripe_charge_id_idx
  on public.seller_orders (stripe_charge_id)
  where stripe_charge_id is not null;

comment on column public.seller_orders.stripe_charge_id is
  'Stripe Charge id (ch_*) that funds marketplace SCTs via source_transaction.';

-- ---------------------------------------------------------------------------
-- 2) wallet_ledger: allow business account_type + business references
-- ---------------------------------------------------------------------------
alter table public.wallet_ledger drop constraint if exists wallet_ledger_account_type_check;
alter table public.wallet_ledger
  add constraint wallet_ledger_account_type_check
  check (
    account_type in (
      'platform',
      'driver',
      'restaurant',
      'seller',
      'partner',
      'client',
      'business'
    )
  );

alter table public.wallet_ledger drop constraint if exists wallet_ledger_reference_type_check;
alter table public.wallet_ledger
  add constraint wallet_ledger_reference_type_check
  check (
    reference_type in (
      'payment_transaction',
      'payout_transaction',
      'commission',
      'refund',
      'adjustment',
      'order_payout',
      'business_topup',
      'business_ride_debit',
      'business_payout',
      'business_refund_credit'
    )
  );

-- Members of a business account may read ledger rows keyed by business_account_id
-- stored in account_user_id (organizational uuid, not necessarily auth.users).
drop policy if exists wallet_ledger_select_business_member on public.wallet_ledger;
create policy wallet_ledger_select_business_member
on public.wallet_ledger for select to authenticated
using (
  account_type = 'business'
  and exists (
    select 1
    from public.taxi_business_members m
    where m.business_account_id = wallet_ledger.account_user_id
      and m.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 3) Business Connect columns on taxi_business_accounts
-- ---------------------------------------------------------------------------
alter table if exists public.taxi_business_accounts
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null,
  add column if not exists country_code text,
  add column if not exists currency text default 'USD',
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarding_status text,
  add column if not exists stripe_charges_enabled boolean default false,
  add column if not exists stripe_payouts_enabled boolean default false,
  add column if not exists stripe_details_submitted boolean default false,
  add column if not exists stripe_onboarded_at timestamptz;

create unique index if not exists taxi_business_accounts_stripe_account_id_uidx
  on public.taxi_business_accounts (stripe_account_id)
  where stripe_account_id is not null;

create index if not exists taxi_business_accounts_owner_user_id_idx
  on public.taxi_business_accounts (owner_user_id)
  where owner_user_id is not null;

comment on column public.taxi_business_accounts.stripe_account_id is
  'Stripe Connect Express account for Business Wallet cash-out (acct_*).';
comment on column public.taxi_business_accounts.stripe_customer_id is
  'Optional Stripe Customer for top-up Checkout; Connect is used for cash-out.';

create or replace function public.taxi_business_accounts_protect_stripe_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  new.stripe_account_id := old.stripe_account_id;
  new.stripe_onboarding_status := old.stripe_onboarding_status;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
  new.stripe_payouts_enabled := old.stripe_payouts_enabled;
  new.stripe_details_submitted := old.stripe_details_submitted;
  new.stripe_onboarded_at := old.stripe_onboarded_at;
  return new;
end;
$$;

drop trigger if exists trg_taxi_business_accounts_protect_stripe_columns
  on public.taxi_business_accounts;
create trigger trg_taxi_business_accounts_protect_stripe_columns
before update on public.taxi_business_accounts
for each row
execute function public.taxi_business_accounts_protect_stripe_columns();

-- ---------------------------------------------------------------------------
-- 4) Business wallet ledger helper entries (optional audit mirror)
-- ---------------------------------------------------------------------------
create table if not exists public.taxi_business_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.taxi_business_accounts (id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD',
  entry_type text not null,
  reference_type text,
  reference_id uuid,
  stripe_payment_intent_id text,
  stripe_transfer_id text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists taxi_business_wallet_entries_account_idx
  on public.taxi_business_wallet_entries (business_account_id, created_at desc);

alter table public.taxi_business_wallet_entries enable row level security;

drop policy if exists taxi_business_wallet_entries_select_member
  on public.taxi_business_wallet_entries;
create policy taxi_business_wallet_entries_select_member
on public.taxi_business_wallet_entries for select to authenticated
using (
  exists (
    select 1
    from public.taxi_business_members m
    where m.business_account_id = taxi_business_wallet_entries.business_account_id
      and m.user_id = auth.uid()
      and coalesce(m.active, true)
  )
);

-- ---------------------------------------------------------------------------
-- 5) Taxi ride tips (mirror food tip PaymentIntent + SCT)
-- ---------------------------------------------------------------------------
alter table if exists public.taxi_rides
  add column if not exists tip_cents integer default 0,
  add column if not exists tip_payment_intent_id text,
  add column if not exists tip_stripe_charge_id text,
  add column if not exists tip_transfer_id text,
  add column if not exists tip_paid_out boolean default false,
  add column if not exists tip_paid_at timestamptz,
  add column if not exists payment_funding text not null default 'stripe';

alter table if exists public.taxi_rides
  drop constraint if exists taxi_rides_payment_funding_check;
alter table if exists public.taxi_rides
  add constraint taxi_rides_payment_funding_check
  check (payment_funding in ('stripe', 'business_wallet'));

comment on column public.taxi_rides.tip_cents is
  'Client tip cents; transferable only after tip PaymentIntent succeeds.';
comment on column public.taxi_rides.payment_funding is
  'Who funded the ride: personal Stripe checkout or Business Wallet ledger debit.';

-- ---------------------------------------------------------------------------
-- 6) Business ride approval helpers
-- ---------------------------------------------------------------------------
create or replace function public.approve_taxi_business_ride(
  p_ride_id uuid,
  p_manager_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_role text;
begin
  select * into v_ride from public.taxi_rides where id = p_ride_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ride_not_found');
  end if;

  if v_ride.business_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_business_ride');
  end if;

  select m.role into v_role
  from public.taxi_business_members m
  where m.business_account_id = v_ride.business_account_id
    and m.user_id = p_manager_user_id
    and coalesce(m.active, true)
  limit 1;

  if v_role is null or v_role not in ('manager', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if coalesce(v_ride.business_approval_status, 'not_required') not in ('pending') then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'business_approval_status', v_ride.business_approval_status
    );
  end if;

  update public.taxi_rides
  set
    business_approval_status = 'approved',
    updated_at = now()
  where id = p_ride_id;

  perform public.record_taxi_business_billing_event(
    v_ride.business_account_id,
    p_ride_id,
    coalesce(v_ride.client_user_id, p_manager_user_id),
    coalesce(v_ride.total_cents, 0),
    'ride_authorized',
    jsonb_build_object('approved_by', p_manager_user_id)
  );

  return jsonb_build_object('ok', true, 'business_approval_status', 'approved');
end;
$$;

create or replace function public.reject_taxi_business_ride(
  p_ride_id uuid,
  p_manager_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_role text;
begin
  select * into v_ride from public.taxi_rides where id = p_ride_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ride_not_found');
  end if;

  if v_ride.business_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_business_ride');
  end if;

  select m.role into v_role
  from public.taxi_business_members m
  where m.business_account_id = v_ride.business_account_id
    and m.user_id = p_manager_user_id
    and coalesce(m.active, true)
  limit 1;

  if v_role is null or v_role not in ('manager', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.taxi_rides
  set
    business_approval_status = 'rejected',
    status = case
      when v_ride.status in ('draft', 'quoted', 'pending_payment', 'scheduled') then 'canceled'
      else v_ride.status
    end,
    cancel_reason = coalesce(nullif(trim(p_reason), ''), 'business_rejected'),
    cancelled_by = 'business_manager',
    cancelled_at = now(),
    updated_at = now()
  where id = p_ride_id;

  perform public.record_taxi_business_billing_event(
    v_ride.business_account_id,
    p_ride_id,
    coalesce(v_ride.client_user_id, p_manager_user_id),
    coalesce(v_ride.total_cents, 0),
    'ride_rejected',
    jsonb_build_object('rejected_by', p_manager_user_id, 'reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'business_approval_status', 'rejected');
end;
$$;

grant execute on function public.approve_taxi_business_ride(uuid, uuid) to authenticated, service_role;
grant execute on function public.reject_taxi_business_ride(uuid, uuid, text) to authenticated, service_role;

commit;
