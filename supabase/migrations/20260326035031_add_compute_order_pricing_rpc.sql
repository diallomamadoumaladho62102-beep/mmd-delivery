drop function if exists public.compute_order_pricing(
  text,
  numeric,
  numeric,
  text,
  text
);

create function public.compute_order_pricing(
  p_order_type text,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_currency text default 'USD',
  p_promo_code text default null
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

  if v_order_type = 'errand' then
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
    raise exception 'missing active pricing_config for key %', v_target_config_key;
  end if;

  v_total_before_discount := round(v_subtotal + v_delivery_fee, 2);

  if coalesce(v_cfg.promo_enabled, false) = true then
    if coalesce(v_cfg.minimum_order_amount, 0) <= v_subtotal then
      if v_cfg.promo_code is null or v_input_promo_code = upper(v_cfg.promo_code) then
        v_promo_code_applied := case
          when v_cfg.promo_code is not null then upper(v_cfg.promo_code)
          else v_input_promo_code
        end;
        v_promo_type_applied := v_cfg.promo_type;
        v_promo_value_applied := v_cfg.promo_value;

        if v_cfg.promo_type = 'percent' then
          v_promo_discount_amount :=
            round(least(v_subtotal, v_subtotal * (coalesce(v_cfg.promo_value, 0) / 100.0)), 2);

        elsif v_cfg.promo_type = 'fixed' then
          v_promo_discount_amount :=
            round(least(v_subtotal, coalesce(v_cfg.promo_value, 0)), 2);

        elsif v_cfg.promo_type = 'free_delivery' then
          v_delivery_discount_amount := round(v_delivery_fee, 2);

        else
          v_promo_code_applied := null;
          v_promo_type_applied := null;
          v_promo_value_applied := null;
          v_promo_discount_amount := 0;
          v_delivery_discount_amount := 0;
        end if;
      end if;
    end if;
  end if;

  v_subtotal_after_discount :=
    round(greatest(v_subtotal - v_promo_discount_amount, 0), 2);

  v_delivery_fee_after_discount :=
    round(greatest(v_delivery_fee - v_delivery_discount_amount, 0), 2);

  v_total_after_discount :=
    round(v_subtotal_after_discount + v_delivery_fee_after_discount, 2);

  config_key := v_cfg.config_key;
  order_type := v_order_type;
  currency := v_currency;
  subtotal := round(v_subtotal, 2);
  delivery_fee := round(v_delivery_fee, 2);
  promo_code_applied := v_promo_code_applied;
  promo_type_applied := v_promo_type_applied;
  promo_value_applied := v_promo_value_applied;
  promo_discount_amount := round(v_promo_discount_amount, 2);
  delivery_discount_amount := round(v_delivery_discount_amount, 2);
  subtotal_after_discount := v_subtotal_after_discount;
  delivery_fee_after_discount := v_delivery_fee_after_discount;
  total_before_discount := round(v_total_before_discount, 2);
  total_after_discount := v_total_after_discount;
  total_cents := (round(v_total_after_discount, 2) * 100)::integer;

  return next;
end
$function$;