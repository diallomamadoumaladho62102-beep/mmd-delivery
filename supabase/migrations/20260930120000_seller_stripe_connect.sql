-- Marketplace sellers: Stripe Connect parity with restaurant_profiles.
-- Service role / Edge write Connect fields; sellers cannot self-overwrite them via RLS updates.

begin;

alter table if exists public.sellers
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarding_status text,
  add column if not exists stripe_charges_enabled boolean,
  add column if not exists stripe_payouts_enabled boolean,
  add column if not exists stripe_details_submitted boolean,
  add column if not exists stripe_onboarded_at timestamptz;

create unique index if not exists sellers_stripe_account_id_uidx
  on public.sellers (stripe_account_id)
  where stripe_account_id is not null;

create index if not exists sellers_stripe_onboarding_status_idx
  on public.sellers (stripe_onboarding_status);

comment on column public.sellers.stripe_account_id is
  'Stripe Connect Express account id (acct_*). Written by service role / Edge only.';
comment on column public.sellers.stripe_onboarding_status is
  'Canonical Connect status: setup_required | verification_pending | verification_in_progress | ready_for_payouts | restricted | disabled';

create or replace function public.sellers_protect_stripe_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Authenticated sellers may update profile fields but not Connect payout state.
  new.stripe_account_id := old.stripe_account_id;
  new.stripe_onboarding_status := old.stripe_onboarding_status;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
  new.stripe_payouts_enabled := old.stripe_payouts_enabled;
  new.stripe_details_submitted := old.stripe_details_submitted;
  new.stripe_onboarded_at := old.stripe_onboarded_at;
  return new;
end;
$$;

drop trigger if exists trg_sellers_protect_stripe_columns on public.sellers;
create trigger trg_sellers_protect_stripe_columns
before update on public.sellers
for each row
execute function public.sellers_protect_stripe_columns();

commit;
