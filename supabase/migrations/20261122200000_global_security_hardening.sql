-- Global security hardening: errand subtotal server authority + site-media storage policies.

begin;

-- Errand orders: ignore client-supplied subtotal; use platform minimum from pricing_config.
create or replace function public.create_errand_order(
  p_pickup_address text,
  p_dropoff_address text,
  p_pickup_contact text default null,
  p_dropoff_contact text default null,
  p_description text default null,
  p_subtotal numeric default 0,
  p_promo_code text default null,
  p_currency text default null,
  p_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid := gen_random_uuid();
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_cfg public.pricing_config%rowtype;
  v_target_config_key text;
  v_subtotal numeric := 0;
  v_pricing record;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if length(v_country) <> 2 then
    select upper(trim(country))
    into v_country
    from public.client_addresses
    where user_id = v_user_id
      and is_default = true
    limit 1;
  end if;

  if v_country is null or length(v_country) <> 2 then
    v_country := 'US';
  end if;

  if v_currency = '' then
    v_currency := 'USD';
  end if;

  if v_country in ('GN', 'SN', 'CI', 'ML', 'SL', 'MR')
     or v_currency in ('GNF', 'XOF', 'SLE', 'MRU') then
    v_target_config_key := 'errand_africa';
  else
    v_target_config_key := 'errand_default';
  end if;

  select pc.*
  into v_cfg
  from public.pricing_config pc
  where pc.config_key = v_target_config_key
    and pc.active = true
  limit 1;

  if v_cfg.id is null then
    select pc.*
    into v_cfg
    from public.pricing_config pc
    where pc.config_key = 'errand_default'
      and pc.active = true
    limit 1;
  end if;

  if v_cfg.id is null then
    return jsonb_build_object('ok', false, 'error', 'pricing_config_missing');
  end if;

  v_subtotal := greatest(
    coalesce(v_cfg.delivery_fee_base, 0),
    coalesce(v_cfg.minimum_order_amount, 0),
    coalesce(v_cfg.fixed_client_fee, 0)
  );

  if v_subtotal <= 0 then
    v_subtotal := 3.49;
  end if;

  select *
  into v_pricing
  from public.compute_order_pricing(
    'errand',
    v_subtotal,
    0,
    v_currency,
    p_promo_code,
    v_country
  )
  limit 1;

  if v_pricing is null then
    return jsonb_build_object('ok', false, 'error', 'pricing_failed');
  end if;

  insert into public.orders (
    id,
    kind,
    status,
    payment_status,
    pickup_address,
    dropoff_address,
    subtotal,
    total,
    grand_total,
    total_cents,
    currency,
    created_by,
    client_user_id
  )
  values (
    v_order_id,
    'errand',
    'pending',
    'unpaid',
    p_pickup_address,
    p_dropoff_address,
    v_pricing.subtotal,
    v_pricing.total_after_discount,
    v_pricing.total_after_discount,
    v_pricing.total_cents,
    v_pricing.currency,
    v_user_id,
    v_user_id
  );

  insert into public.order_members (order_id, user_id, role)
  values (v_order_id, v_user_id, 'client')
  on conflict (order_id, user_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'id', v_order_id,
    'promo_code', p_promo_code,
    'config_key', v_pricing.config_key,
    'country_code', v_country,
    'currency', v_pricing.currency,
    'total_cents', v_pricing.total_cents
  );
end;
$$;

revoke all on function public.create_errand_order(
  text, text, text, text, text, numeric, text, text, text
) from public;
grant execute on function public.create_errand_order(
  text, text, text, text, text, numeric, text, text, text
) to authenticated, service_role;

-- site-media: public read for CMS assets; writes restricted to service_role.
insert into storage.buckets (id, name, public)
values ('site-media', 'site-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists site_media_public_read on storage.objects;
create policy site_media_public_read on storage.objects
  for select
  to public
  using (bucket_id = 'site-media');

drop policy if exists site_media_service_insert on storage.objects;
create policy site_media_service_insert on storage.objects
  for insert
  to service_role
  with check (bucket_id = 'site-media');

drop policy if exists site_media_service_update on storage.objects;
create policy site_media_service_update on storage.objects
  for update
  to service_role
  using (bucket_id = 'site-media')
  with check (bucket_id = 'site-media');

drop policy if exists site_media_service_delete on storage.objects;
create policy site_media_service_delete on storage.objects
  for delete
  to service_role
  using (bucket_id = 'site-media');

commit;
