-- Guinea cash taxi.
-- Adds payment_method and cash statuses. Does not update historical ride amounts.

begin;

alter table public.taxi_rides
  add column if not exists payment_method text;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'taxi_rides'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%payment_status%'
  loop
    execute format('alter table public.taxi_rides drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.taxi_rides
  drop constraint if exists taxi_rides_payment_status_check;

alter table public.taxi_rides
  add constraint taxi_rides_payment_status_check
  check (
    payment_status in (
      'unpaid',
      'processing',
      'paid',
      'refunded',
      'pending_cash',
      'cash_collected'
    )
  );

alter table public.taxi_rides
  drop constraint if exists taxi_rides_payment_method_check;

alter table public.taxi_rides
  add constraint taxi_rides_payment_method_check
  check (
    payment_method is null
    or payment_method in ('card', 'cash', 'orange_money', 'stripe')
  );

create index if not exists taxi_rides_market_payment_idx
  on public.taxi_rides (country_code, currency, payment_status);

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
      'business_refund_credit',
      'cash_collection'
    )
  );

create unique index if not exists wallet_ledger_cash_collection_once
  on public.wallet_ledger (reference_id)
  where reference_type = 'cash_collection';

create or replace function public.guard_taxi_rides_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_auth_role text := '';
begin
  begin
    v_auth_role := coalesce(auth.role(), '');
  exception
    when others then
      v_auth_role := '';
  end;

  if v_jwt_role = 'service_role'
     or session_user::text = 'service_role'
     or current_user::text = 'service_role'
     or v_auth_role = 'service_role'
  then
    return NEW;
  end if;

  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if NEW.subtotal_cents is distinct from OLD.subtotal_cents then
    raise exception 'taxi_rides_financial_update_forbidden: subtotal_cents';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'taxi_rides_financial_update_forbidden: total_cents';
  end if;
  if NEW.gross_total_cents is distinct from OLD.gross_total_cents then
    raise exception 'taxi_rides_financial_update_forbidden: gross_total_cents';
  end if;
  if NEW.discount_cents is distinct from OLD.discount_cents then
    raise exception 'taxi_rides_financial_update_forbidden: discount_cents';
  end if;
  if NEW.platform_fee_cents is distinct from OLD.platform_fee_cents then
    raise exception 'taxi_rides_financial_update_forbidden: platform_fee_cents';
  end if;
  if NEW.driver_payout_cents is distinct from OLD.driver_payout_cents then
    raise exception 'taxi_rides_financial_update_forbidden: driver_payout_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'taxi_rides_financial_update_forbidden: currency';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'taxi_rides_financial_update_forbidden: payment_status';
  end if;
  if lower(coalesce(NEW.payment_method, '')) is distinct from lower(coalesce(OLD.payment_method, '')) then
    raise exception 'taxi_rides_financial_update_forbidden: payment_method';
  end if;

  return NEW;
end;
$$;

create or replace function public.taxi_ride_payment_allows_dispatch(
  p_payment_status text,
  p_payment_method text
) returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_payment_status, '')) = 'paid'
    or (
      lower(coalesce(p_payment_method, '')) = 'cash'
      and lower(coalesce(p_payment_status, '')) = 'pending_cash'
    );
$$;

revoke all on function public.taxi_ride_payment_allows_dispatch(text, text) from public;
grant execute on function public.taxi_ride_payment_allows_dispatch(text, text) to authenticated, service_role;

create or replace function public.validate_taxi_offer_acceptance(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_vehicle_id uuid;
  v_accept_standard boolean := false;
  v_fuel text;
  v_next jsonb;
  v_settings public.driver_capacity_settings%rowtype;
  v_pickup_miles double precision;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'not_authenticated', 'reason_message', 'Authentification requise.');
  end if;

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_found', 'reason_message', 'Offre introuvable.');
  end if;

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_found', 'reason_message', 'Course introuvable.');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_available', 'reason_message', 'Offre expirée ou indisponible.');
  end if;

  if not public.is_driver_identity_verified_for_taxi(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'identity_not_verified', 'reason_message', 'Vérification d''identité requise.');
  end if;

  if not public.is_taxi_account_active(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'account_inactive', 'reason_message', 'Compte inactif.');
  end if;

  if to_regprocedure('public.is_driver_operational(uuid)') is not null then
    if not public.is_driver_operational(v_driver_id) then
      return jsonb_build_object('ok', false, 'reason_code', 'driver_not_operational', 'reason_message', 'Compte chauffeur non approuvé.');
    end if;
  end if;

  if not exists (
    select 1 from public.driver_profiles dp
    where dp.user_id = v_driver_id and coalesce(dp.is_online, false) = true
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'driver_offline', 'reason_message', 'Vous devez être en ligne pour accepter.');
  end if;

  select * into v_settings from public.driver_capacity_settings where singleton = true;

  -- Active ride blocking with next-ride exception
  if public.driver_active_taxi_ride_count(v_driver_id) > 0
     and not exists (
       select 1 from public.taxi_rides tr
       where tr.id = v_ride.id and tr.driver_id = v_driver_id
     ) then
    v_next := public.taxi_driver_next_ride_eligible(v_driver_id);
    if coalesce((v_next->>'ok')::boolean, false) is not true
       or coalesce(v_next->>'mode', '') <> 'next_ride' then
      return jsonb_build_object(
        'ok', false,
        'reason_code', 'driver_unavailable',
        'reason_message', 'Vous avez déjà une course active.'
      );
    end if;

    -- Pickup of next ride must be near current dropoff (not original pickup)
    if v_ride.pickup_lat is not null and v_ride.pickup_lng is not null
       and (v_next->>'dropoff_lat') is not null and (v_next->>'dropoff_lng') is not null then
      v_pickup_miles := public.haversine_miles(
        (v_next->>'dropoff_lat')::double precision,
        (v_next->>'dropoff_lng')::double precision,
        v_ride.pickup_lat::double precision,
        v_ride.pickup_lng::double precision
      );
      if v_pickup_miles is not null
         and v_pickup_miles > coalesce(v_settings.next_ride_distance_threshold_miles, 2) * 2 then
        return jsonb_build_object(
          'ok', false,
          'reason_code', 'next_pickup_too_far',
          'reason_message', 'Le prochain pickup est trop loin de votre destination actuelle.'
        );
      end if;
    end if;
  end if;

  if public.driver_queued_taxi_ride_count(v_driver_id) >= coalesce(v_settings.max_queued_taxi_rides, 1)
     and not exists (
       select 1 from public.taxi_rides tr
       where tr.id = v_ride.id and tr.driver_id = v_driver_id
     ) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'next_ride_already_queued',
      'reason_message', 'Vous avez déjà une prochaine course en file.'
    );
  end if;

  if not public.is_driver_service_enabled(v_driver_id, 'taxi') then
    return jsonb_build_object('ok', false, 'reason_code', 'taxi_service_disabled', 'reason_message', 'Service taxi désactivé.');
  end if;

  v_vehicle_id := public.get_driver_active_vehicle_id(v_driver_id);
  if v_vehicle_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'no_active_vehicle', 'reason_message', 'Aucun véhicule actif.');
  end if;

  if not public.driver_vehicle_documents_valid(v_vehicle_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'vehicle_documents_invalid', 'reason_message', 'Documents véhicule invalides ou expirés.');
  end if;

  select coalesce(dsp.accept_also_standard_rides, false)
  into v_accept_standard
  from public.driver_service_preferences dsp
  where dsp.driver_user_id = v_driver_id;

  if not public.driver_matches_taxi_ride_category(v_vehicle_id, v_ride.vehicle_class, v_accept_standard) then
    return jsonb_build_object('ok', false, 'reason_code', 'category_not_eligible', 'reason_message', 'Catégorie véhicule incompatible avec la course.');
  end if;

  if not public.driver_satisfies_ride_preferences(v_driver_id, v_ride.id) then
    return jsonb_build_object('ok', false, 'reason_code', 'preferences_not_met', 'reason_message', 'Vous ne correspondez plus aux préférences client de cette course.');
  end if;

  if not public.taxi_ride_payment_allows_dispatch(v_ride.payment_status, v_ride.payment_method) then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_paid', 'reason_message', 'Course non payée.');
  end if;

  if v_ride.driver_id is not null and v_ride.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'reason_code', 'already_assigned', 'reason_message', 'Course déjà assignée.');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('paid', 'dispatching', 'queued') then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_available', 'reason_message', 'Course non disponible.');
  end if;

  select dv.fuel_type into v_fuel from public.driver_vehicles dv where dv.id = v_vehicle_id;

  return jsonb_build_object(
    'ok', true,
    'vehicle_id', v_vehicle_id,
    'fuel_type', v_fuel,
    'is_green_vehicle', public.taxi_fuel_type_is_green(v_fuel),
    'client_preferences', coalesce(v_ride.client_preferences, '{}'::jsonb),
    'ambiance_preference', v_ride.ambiance_preference,
    'next_ride', coalesce(v_next, '{}'::jsonb)
  );
end;
$$;

create or replace function public.driver_accept_taxi_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_validation jsonb;
  v_vehicle_id uuid;
  v_fuel text;
  v_is_green boolean;
  v_old_status text;
  v_sync jsonb;
  v_vehicle public.driver_vehicles%rowtype;
  v_driver_name text;
  v_driver_photo text;
  v_driver_rating numeric(4, 2);
  v_driver_trips integer;
  v_next jsonb;
  v_queue boolean := false;
  v_active_id uuid;
  v_eta integer;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  perform pg_advisory_xact_lock(hashtext('taxi_capacity:' || v_driver_id::text));

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  v_validation := public.validate_taxi_offer_acceptance(p_offer_id);

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    update public.taxi_offers
    set
      status = 'rejected',
      reject_reason_code = v_validation->>'reason_code',
      reject_reason_message = v_validation->>'reason_message',
      updated_at = now()
    where id = p_offer_id;

    insert into public.taxi_accept_audit_events (
      taxi_ride_id, taxi_offer_id, driver_user_id, vehicle_id,
      reason_code, reason_message, metadata
    ) values (
      v_offer.taxi_ride_id,
      p_offer_id,
      v_driver_id,
      nullif(v_validation->>'vehicle_id', '')::uuid,
      coalesce(v_validation->>'reason_code', 'validation_failed'),
      v_validation->>'reason_message',
      v_validation
    );

    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_validation->>'reason_code', 'validation_failed'),
      'reason_message', v_validation->>'reason_message',
      'should_redispatch', true,
      'taxi_ride_id', v_offer.taxi_ride_id
    );
  end if;

  v_vehicle_id := (v_validation->>'vehicle_id')::uuid;
  v_fuel := v_validation->>'fuel_type';
  v_is_green := coalesce((v_validation->>'is_green_vehicle')::boolean, false);
  v_next := coalesce(v_validation->'next_ride', '{}'::jsonb);
  v_queue := coalesce(v_next->>'mode', '') = 'next_ride'
    and public.driver_active_taxi_ride_count(v_driver_id) > 0;
  v_active_id := nullif(v_next->>'active_ride_id', '')::uuid;
  v_eta := ceil(coalesce((v_next->>'remaining_minutes')::numeric, 5));

  select * into v_vehicle
  from public.driver_vehicles
  where id = v_vehicle_id
    and driver_user_id = v_driver_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'vehicle_not_found',
      'should_redispatch', true,
      'taxi_ride_id', v_offer.taxi_ride_id
    );
  end if;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(dp.full_name), ''),
      'Chauffeur'
    ),
    coalesce(nullif(trim(dp.photo_url), ''), nullif(trim(p.avatar_url), '')),
    coalesce(dp.rating, tdf.rating_taxi),
    coalesce(dp.total_deliveries, dp.rating_count, 0)
  into v_driver_name, v_driver_photo, v_driver_rating, v_driver_trips
  from public.driver_profiles dp
  left join public.profiles p on p.id = dp.user_id
  left join public.taxi_driver_features tdf on tdf.user_id = dp.user_id
  where dp.user_id = v_driver_id;

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id for update;

  if v_queue then
    -- Double-check queued slot under lock
    if public.driver_queued_taxi_ride_count(v_driver_id) >= 1 then
      return jsonb_build_object('ok', false, 'message', 'next_ride_already_queued', 'should_redispatch', true);
    end if;

    update public.taxi_rides
    set
      driver_id = v_driver_id,
      status = 'queued',
      queued_after_ride_id = v_active_id,
      next_ride_eta_minutes = v_eta,
      assigned_vehicle_id = v_vehicle_id,
      assigned_fuel_type = v_fuel,
      is_green_vehicle = v_is_green,
      driver_display_name = v_driver_name,
      driver_photo_url = v_driver_photo,
      driver_rating_snapshot = v_driver_rating,
      driver_trips_count_snapshot = v_driver_trips,
      vehicle_make_snapshot = v_vehicle.vehicle_make,
      vehicle_model_snapshot = v_vehicle.vehicle_model,
      vehicle_year_snapshot = v_vehicle.vehicle_year,
      vehicle_color_snapshot = v_vehicle.vehicle_color,
      vehicle_plate_snapshot = v_vehicle.license_plate,
      vehicle_photo_url_snapshot = null,
      updated_at = now()
    where id = v_ride.id
      and driver_id is null
      and public.taxi_ride_payment_allows_dispatch(payment_status, payment_method)
      and lower(coalesce(status, '')) in ('paid', 'dispatching');

    if not found then
      return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available', 'should_redispatch', true);
    end if;
  else
    update public.taxi_rides
    set
      driver_id = v_driver_id,
      status = 'accepted',
      accepted_at = now(),
      assigned_vehicle_id = v_vehicle_id,
      assigned_fuel_type = v_fuel,
      is_green_vehicle = v_is_green,
      driver_display_name = v_driver_name,
      driver_photo_url = v_driver_photo,
      driver_rating_snapshot = v_driver_rating,
      driver_trips_count_snapshot = v_driver_trips,
      vehicle_make_snapshot = v_vehicle.vehicle_make,
      vehicle_model_snapshot = v_vehicle.vehicle_model,
      vehicle_year_snapshot = v_vehicle.vehicle_year,
      vehicle_color_snapshot = v_vehicle.vehicle_color,
      vehicle_plate_snapshot = v_vehicle.license_plate,
      vehicle_photo_url_snapshot = null,
      updated_at = now()
    where id = v_ride.id
      and driver_id is null
      and public.taxi_ride_payment_allows_dispatch(payment_status, payment_method)
      and lower(coalesce(status, '')) in ('paid', 'dispatching');

    if not found then
      return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available', 'should_redispatch', true);
    end if;
  end if;

  update public.taxi_offers
  set status = 'accepted', vehicle_id = v_vehicle_id, fuel_type = v_fuel, updated_at = now()
  where id = p_offer_id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> p_offer_id
    and status = 'pending';

  if not v_queue then
    v_sync := public.sync_taxi_shared_ride_driver(v_ride.id, v_driver_id);
  else
    v_sync := jsonb_build_object('queued', true);
  end if;

  v_old_status := coalesce(v_ride.status, 'dispatching');

  perform public.log_taxi_event(
    v_ride.id,
    case when v_queue then 'driver_queued_next_ride' else 'driver_accepted' end,
    v_old_status,
    case when v_queue then 'queued' else 'accepted' end,
    v_driver_id,
    'driver',
    case when v_queue then 'Driver queued next taxi ride' else 'Driver accepted taxi offer' end,
    jsonb_build_object(
      'offer_id', p_offer_id,
      'vehicle_id', v_vehicle_id,
      'fuel_type', v_fuel,
      'vehicle_plate', v_vehicle.license_plate,
      'shared_sync', v_sync,
      'queued_after_ride_id', v_active_id,
      'next_ride_eta_minutes', v_eta
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', v_ride.id,
    'vehicle_id', v_vehicle_id,
    'is_green_vehicle', v_is_green,
    'vehicle_plate', v_vehicle.license_plate,
    'queued', v_queue,
    'queued_after_ride_id', v_active_id,
    'next_ride_eta_minutes', v_eta
  );
end;
$$;


commit;
