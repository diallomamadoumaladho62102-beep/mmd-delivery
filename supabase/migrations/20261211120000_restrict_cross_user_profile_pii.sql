-- Stop authenticated clients from reading every restaurant account on profiles.
-- Public restaurant catalog keeps name, address, and phone.
-- Email, tax id, license, push token, and Stripe account fields are owner/staff only.

drop policy if exists "Allow all users to read restaurant profiles" on public.profiles;

revoke select on table public.restaurant_profiles from anon, authenticated;

grant select (
  user_id,
  restaurant_name,
  address,
  phone,
  created_at,
  updated_at,
  opening_hours,
  offers_delivery,
  offers_pickup,
  offers_dine_in,
  website,
  instagram,
  facebook,
  city,
  postal_code,
  cuisine_type,
  description,
  status,
  lat,
  lng,
  location_lat,
  location_lng,
  is_accepting_orders,
  auto_accept_orders_enabled,
  auto_accept_only_during_hours,
  default_prep_minutes,
  auto_pause_when_closed,
  auto_pause_when_busy,
  busy_order_threshold,
  auto_print_enabled,
  print_kitchen_ticket,
  print_customer_ticket,
  print_driver_ticket,
  print_copies,
  print_paper_width,
  print_show_qr_code,
  print_special_instructions,
  is_busy,
  cover_image_url,
  logo_url,
  avatar_url
) on table public.restaurant_profiles to anon, authenticated;

drop function if exists public.restaurant_profile_sensitive(uuid);

create function public.restaurant_profile_sensitive(p_user_id uuid default null)
returns table (
  user_id uuid,
  email text,
  tax_id text,
  license_number text,
  expo_push_token text,
  stripe_account_id text,
  stripe_onboarded boolean,
  stripe_onboarded_at timestamptz,
  stripe_onboarding_status text,
  stripe_charges_enabled boolean,
  stripe_payouts_enabled boolean,
  stripe_details_submitted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if p_user_id is not null then
    if auth.uid() = p_user_id
       or public.is_staff_user(auth.uid())
       or public.is_super_admin_user() then
      return query
      select
        rp.user_id,
        rp.email,
        rp.tax_id,
        rp.license_number,
        rp.expo_push_token,
        rp.stripe_account_id,
        rp.stripe_onboarded,
        rp.stripe_onboarded_at,
        rp.stripe_onboarding_status,
        rp.stripe_charges_enabled,
        rp.stripe_payouts_enabled,
        rp.stripe_details_submitted
      from public.restaurant_profiles rp
      where rp.user_id = p_user_id;
    end if;
    return;
  end if;

  if public.is_staff_user(auth.uid()) or public.is_super_admin_user() then
    return query
    select
      rp.user_id,
      rp.email,
      rp.tax_id,
      rp.license_number,
      rp.expo_push_token,
      rp.stripe_account_id,
      rp.stripe_onboarded,
      rp.stripe_onboarded_at,
      rp.stripe_onboarding_status,
      rp.stripe_charges_enabled,
      rp.stripe_payouts_enabled,
      rp.stripe_details_submitted
    from public.restaurant_profiles rp;
  end if;
end;
$$;

revoke all on function public.restaurant_profile_sensitive(uuid) from public;
grant execute on function public.restaurant_profile_sensitive(uuid) to authenticated;

comment on function public.restaurant_profile_sensitive(uuid) is
  'Owner or staff read of restaurant email, tax id, license, push token, and Stripe account fields.';
