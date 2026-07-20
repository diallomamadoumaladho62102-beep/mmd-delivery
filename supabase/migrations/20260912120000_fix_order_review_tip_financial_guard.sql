-- Fix post-delivery review/tip: orders_financial_update_forbidden: grand_total
--
-- Root cause: guard_orders_client_financial_update() is a BEFORE UPDATE trigger
-- that compared NEW.grand_total / NEW.total_cents. Those columns are GENERATED
-- ALWAYS STORED. PostgreSQL computes generated columns AFTER BEFORE triggers,
-- so NEW.<generated> must not be read there — the comparison falsely fails on
-- every client update, including tip_cents-only updates after delivery.
--
-- Fix:
-- 1) Guard only writable base financial columns (never generated ones).
-- 2) Official RPC submit_order_review_and_tip: rating independent of tip;
--    tip_cents recorded without touching paid historical totals.

begin;

create or replace function public.guard_orders_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

  -- Writable financial bases only. Do NOT compare generated columns
  -- (grand_total, total_cents): NEW values are undefined in BEFORE triggers.
  if NEW.subtotal is distinct from OLD.subtotal then
    raise exception 'orders_financial_update_forbidden: subtotal';
  end if;
  if NEW.tax is distinct from OLD.tax then
    raise exception 'orders_financial_update_forbidden: tax';
  end if;
  if NEW.total is distinct from OLD.total then
    raise exception 'orders_financial_update_forbidden: total';
  end if;
  if NEW.items_subtotal is distinct from OLD.items_subtotal then
    raise exception 'orders_financial_update_forbidden: items_subtotal';
  end if;
  if NEW.tax_amount is distinct from OLD.tax_amount then
    raise exception 'orders_financial_update_forbidden: tax_amount';
  end if;
  if NEW.discounts is distinct from OLD.discounts then
    raise exception 'orders_financial_update_forbidden: discounts';
  end if;
  if NEW.subtotal_cents is distinct from OLD.subtotal_cents then
    raise exception 'orders_financial_update_forbidden: subtotal_cents';
  end if;
  if NEW.delivery_fee_cents is distinct from OLD.delivery_fee_cents then
    raise exception 'orders_financial_update_forbidden: delivery_fee_cents';
  end if;
  if NEW.taxes_cents is distinct from OLD.taxes_cents then
    raise exception 'orders_financial_update_forbidden: taxes_cents';
  end if;
  if NEW.tax_cents is distinct from OLD.tax_cents then
    raise exception 'orders_financial_update_forbidden: tax_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'orders_financial_update_forbidden: currency';
  end if;
  if NEW.delivery_fee is distinct from OLD.delivery_fee then
    raise exception 'orders_financial_update_forbidden: delivery_fee';
  end if;
  if NEW.service_fee is distinct from OLD.service_fee then
    raise exception 'orders_financial_update_forbidden: service_fee';
  end if;
  if NEW.service_fee_cents is distinct from OLD.service_fee_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_cents';
  end if;
  if NEW.service_fee_pct is distinct from OLD.service_fee_pct then
    raise exception 'orders_financial_update_forbidden: service_fee_pct';
  end if;
  if NEW.service_fee_enabled is distinct from OLD.service_fee_enabled then
    raise exception 'orders_financial_update_forbidden: service_fee_enabled';
  end if;
  if NEW.service_fee_fixed_cents is distinct from OLD.service_fee_fixed_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_fixed_cents';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'orders_financial_update_forbidden: payment_status';
  end if;

  -- tip_cents is intentionally allowed for the order owner after delivery
  -- (see orders_tip_update_client_delivered + guard_tip_cents_update).
  -- It must never rewrite paid historical totals above.

  return NEW;
end;
$$;

create or replace function public.submit_order_review_and_tip(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null,
  p_tip_cents integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_tip integer := greatest(coalesce(p_tip_cents, 0), 0);
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_tip_applied integer := 0;
  v_rating_upserted boolean := false;
  v_grand_before numeric;
  v_grand_after numeric;
  v_total_cents_before integer;
  v_total_cents_after integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  if v_comment is not null then
    v_comment := left(v_comment, 800);
  end if;

  select
    o.id,
    o.status,
    o.payment_status,
    o.tip_cents,
    o.grand_total,
    o.total_cents,
    o.client_id,
    o.client_user_id,
    o.created_by,
    o.user_id,
    o.driver_id
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_uid is distinct from coalesce(
    v_order.client_id,
    v_order.client_user_id,
    v_order.created_by,
    v_order.user_id
  ) then
    raise exception 'Not allowed (not order owner)';
  end if;

  if lower(coalesce(v_order.status, '')) <> 'delivered' then
    raise exception 'Review/tip only allowed when order is delivered';
  end if;

  v_grand_before := v_order.grand_total;
  v_total_cents_before := v_order.total_cents;

  -- 1) Review is independent of tip / finance.
  insert into public.order_ratings (order_id, rater_id, rating, comment)
  values (p_order_id, v_uid, p_rating, v_comment)
  on conflict (order_id, rater_id) do update
    set
      rating = excluded.rating,
      comment = excluded.comment,
      updated_at = now();

  v_rating_upserted := true;

  -- 2) Tip recording only (idempotent). Does not rewrite paid totals.
  if v_tip > 0 then
    if coalesce(v_order.tip_cents, 0) > 0 then
      -- Already tipped: keep original tip (idempotent success).
      v_tip_applied := coalesce(v_order.tip_cents, 0);
    else
      update public.orders
      set tip_cents = v_tip
      where id = p_order_id
        and coalesce(tip_cents, 0) = 0;

      v_tip_applied := v_tip;
    end if;
  else
    v_tip_applied := coalesce(v_order.tip_cents, 0);
  end if;

  select o.grand_total, o.total_cents
    into v_grand_after, v_total_cents_after
  from public.orders o
  where o.id = p_order_id;

  if v_grand_after is distinct from v_grand_before
     or v_total_cents_after is distinct from v_total_cents_before then
    raise exception 'order_paid_totals_must_remain_frozen';
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'rated', v_rating_upserted,
    'rating', p_rating,
    'tip_cents', v_tip_applied,
    'grand_total', v_grand_after,
    'total_cents', v_total_cents_after
  );
end;
$$;

revoke all on function public.submit_order_review_and_tip(uuid, integer, text, integer) from public;
grant execute on function public.submit_order_review_and_tip(uuid, integer, text, integer) to authenticated;
grant execute on function public.submit_order_review_and_tip(uuid, integer, text, integer) to service_role;

-- Keep legacy rate_order aligned: rating table + tip without mutating paid totals.
create or replace function public.rate_order(
  p_order_id uuid,
  p_rating integer,
  p_comment text default null,
  p_tip_cents integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.submit_order_review_and_tip(
    p_order_id,
    p_rating,
    p_comment,
    p_tip_cents
  );
end;
$$;

commit;
