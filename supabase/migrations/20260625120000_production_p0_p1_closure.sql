-- Production P0/P1 closure: country inference, Africa zones, africa pricing RPC

begin;

-- ---------------------------------------------------------------------------
-- 1) Improved platform country inference (coords before currency)
-- ---------------------------------------------------------------------------

create or replace function public.infer_platform_country_code(
  p_currency text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_lat double precision := p_lat;
  v_lng double precision := p_lng;
begin
  if v_lat is not null and v_lng is not null then
    if v_lat >= 14.5 and v_lat <= 27.5 and v_lng >= -17 and v_lng <= -4 then
      return 'MR';
    end if;
    if v_lat >= 7 and v_lat <= 13 and v_lng >= -15 and v_lng <= -8 then
      return 'GN';
    end if;
    if v_lat >= 6.5 and v_lat <= 10 and v_lng >= -13.5 and v_lng <= -10 then
      return 'SL';
    end if;
    if v_lat >= 4 and v_lat <= 11 and v_lng >= -8.5 and v_lng <= -2.5 then
      return 'CI';
    end if;
    if v_lat >= 12 and v_lat <= 17 and v_lng >= -18 and v_lng <= -11 then
      return 'SN';
    end if;
    if v_lat >= 10 and v_lat <= 25 and v_lng >= -12 and v_lng <= 4 then
      return 'ML';
    end if;
  end if;

  if v_currency = 'USD' then return 'US'; end if;
  if v_currency = 'CAD' then return 'CA'; end if;
  if v_currency = 'GBP' then return 'GB'; end if;
  if v_currency = 'EUR' then return 'FR'; end if;
  if v_currency = 'GNF' then return 'GN'; end if;
  if v_currency = 'XOF' then return 'SN'; end if;
  if v_currency = 'SLE' then return 'SL'; end if;
  if v_currency = 'MRU' then return 'MR'; end if;

  return 'US';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Activate SN / CI / ML zones + seed SL / MR
-- ---------------------------------------------------------------------------

update public.mmd_zones
set is_active = true, updated_at = now()
where country_code in ('SN', 'CI', 'ML')
  and is_active = false;

insert into public.mmd_zones (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  zone_code, zone_name, is_active
) values
  ('SL', 'Western Area', null, 'Freetown', null, null, 'sl_freetown', 'Freetown', true),
  ('SL', 'Western Area', 'Freetown', 'Freetown', 'Central', null, 'sl_freetown_central', 'Central Freetown', true),
  ('MR', 'Nouakchott', null, 'Nouakchott', null, null, 'mr_nouakchott', 'Nouakchott', true),
  ('MR', 'Nouakchott', 'Nouakchott', 'Nouakchott', 'Tevragh-Zeina', null, 'mr_tevragh_zeina', 'Tevragh-Zeina', true)
on conflict (zone_code) do update
set
  zone_name = excluded.zone_name,
  is_active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) compute_order_pricing — africa config when country/currency indicates Africa
-- ---------------------------------------------------------------------------

drop function if exists public.compute_order_pricing(text, numeric, numeric, text, text);
drop function if exists public.compute_order_pricing(text, numeric, numeric, text, text, text);

create function public.compute_order_pricing(
  p_order_type text,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_currency text default 'USD',
  p_promo_code text default null,
  p_country_code text default null
)
returns table (
  config_key text,
  order_type text,
  currency text,
  subtotal numeric,
  delivery_fee numeric,
  promo_code_applied text,
  promo_type_applied text,
  promo_value_applied numeric,
  promo_discount_amount numeric,
  delivery_discount_amount numeric,
  subtotal_after_discount numeric,
  delivery_fee_after_discount numeric,
  total_before_discount numeric,
  total_after_discount numeric,
  total_cents integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_type text := lower(trim(coalesce(p_order_type, 'food')));
  v_target_config_key text;
  v_subtotal numeric := greatest(coalesce(p_subtotal, 0), 0);
  v_delivery_fee numeric := greatest(coalesce(p_delivery_fee, 0), 0);
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_input_promo_code text := upper(nullif(trim(coalesce(p_promo_code, '')), ''));

  v_cfg public.pricing_config%rowtype;

  v_promo_code_applied text := null;
  v_promo_type_applied text := null;
  v_promo_value_applied numeric := null;
  v_promo_discount_amount numeric := 0;
  v_delivery_discount_amount numeric := 0;

  v_subtotal_after_discount numeric := 0;
  v_delivery_fee_after_discount numeric := 0;
  v_total_before_discount numeric := 0;
  v_total_after_discount numeric := 0;
begin
  if v_order_type not in ('food', 'errand') then
    raise exception 'unsupported order_type: %', v_order_type;
  end if;

  if v_country in ('GN', 'SN', 'CI', 'ML', 'SL', 'MR')
     or v_currency in ('GNF', 'XOF', 'SLE', 'MRU') then
    v_target_config_key := case when v_order_type = 'errand' then 'errand_africa' else 'food_africa' end;
  elsif v_order_type = 'errand' then
    v_target_config_key := 'errand_default';
  else
    v_target_config_key := 'food_default';
  end if;

  select pc.*
  into v_cfg
  from public.pricing_config pc
  where pc.config_key = v_target_config_key
    and pc.active = true
  limit 1;

  if v_cfg.id is null then
    v_target_config_key := case when v_order_type = 'errand' then 'errand_default' else 'food_default' end;
    select pc.*
    into v_cfg
    from public.pricing_config pc
    where pc.config_key = v_target_config_key
      and pc.active = true
    limit 1;
  end if;

  if v_cfg.id is null then
    raise exception 'missing active pricing_config for key %', v_target_config_key;
  end if;

  v_total_before_discount := round(v_subtotal + v_delivery_fee, 2);

  if v_cfg.promo_enabled
     and v_input_promo_code is not null
     and upper(coalesce(v_cfg.promo_code, '')) = v_input_promo_code
     and (v_cfg.promo_starts_at is null or v_cfg.promo_starts_at <= now())
     and (v_cfg.promo_ends_at is null or v_cfg.promo_ends_at >= now()) then
    v_promo_code_applied := v_input_promo_code;
    v_promo_type_applied := v_cfg.promo_type;
    v_promo_value_applied := v_cfg.promo_value;

    if v_cfg.promo_type = 'percent' then
      v_promo_discount_amount := round(v_subtotal * (coalesce(v_cfg.promo_value, 0) / 100.0), 2);
    elsif v_cfg.promo_type = 'fixed' then
      v_promo_discount_amount := round(least(coalesce(v_cfg.promo_value, 0), v_subtotal), 2);
    elsif v_cfg.promo_type = 'free_delivery' then
      v_delivery_discount_amount := v_delivery_fee;
    end if;
  end if;

  v_subtotal_after_discount := greatest(round(v_subtotal - v_promo_discount_amount, 2), 0);
  v_delivery_fee_after_discount := greatest(round(v_delivery_fee - v_delivery_discount_amount, 2), 0);
  v_total_after_discount := round(v_subtotal_after_discount + v_delivery_fee_after_discount, 2);

  return query
  select
    v_cfg.config_key,
    v_cfg.order_type,
    v_cfg.currency,
    v_subtotal,
    v_delivery_fee,
    v_promo_code_applied,
    v_promo_type_applied,
    v_promo_value_applied,
    v_promo_discount_amount,
    v_delivery_discount_amount,
    v_subtotal_after_discount,
    v_delivery_fee_after_discount,
    v_total_before_discount,
    v_total_after_discount,
    (round(v_total_after_discount * 100))::integer;
end;
$function$;

revoke all on function public.compute_order_pricing(text, numeric, numeric, text, text, text) from public;
grant execute on function public.compute_order_pricing(text, numeric, numeric, text, text, text) to authenticated, service_role;

commit;
