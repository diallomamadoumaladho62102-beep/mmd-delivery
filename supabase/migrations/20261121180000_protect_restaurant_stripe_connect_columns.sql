-- Restaurant Connect columns: same self-write freeze as sellers.
-- Authenticated restaurants cannot invent/swap stripe_account_id or fake
-- charges_enabled / payouts_enabled. Service role / Edge remain the writers.
-- Does NOT create Connect accounts. Idempotent.

create or replace function public.restaurant_profiles_protect_stripe_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.stripe_account_id := null;
    new.stripe_onboarding_status := coalesce(new.stripe_onboarding_status, 'pending');
    new.stripe_charges_enabled := false;
    new.stripe_payouts_enabled := false;
    new.stripe_details_submitted := false;
    new.stripe_onboarded := false;
    new.stripe_onboarded_at := null;
    return new;
  end if;

  new.stripe_account_id := old.stripe_account_id;
  new.stripe_onboarding_status := old.stripe_onboarding_status;
  new.stripe_charges_enabled := old.stripe_charges_enabled;
  new.stripe_payouts_enabled := old.stripe_payouts_enabled;
  new.stripe_details_submitted := old.stripe_details_submitted;
  new.stripe_onboarded := old.stripe_onboarded;
  new.stripe_onboarded_at := old.stripe_onboarded_at;
  return new;
end;
$$;

drop trigger if exists trg_restaurant_profiles_protect_stripe_columns
  on public.restaurant_profiles;
create trigger trg_restaurant_profiles_protect_stripe_columns
before insert or update on public.restaurant_profiles
for each row
execute function public.restaurant_profiles_protect_stripe_columns();
