-- Delivery rating harden: Client→Driver dual-write from submit_order_review_and_tip.
-- Keeps order_ratings (restaurant/order experience) and adds driver_ratings when driver_id set.
-- Additive / non-destructive. Does NOT delete existing order_ratings or driver_ratings.
--
-- NOT APPLIED YET — await founder approval before db push.
-- API routes /api/orders/[orderId]/rating and /api/delivery-requests/[id]/rating
-- already dual-write without this migration; this keeps legacy RPC clients aligned.

begin;

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
  v_driver_rating_upserted boolean := false;
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
    o.driver_id,
    o.external_ref_type,
    o.external_ref_id
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

  insert into public.order_ratings (order_id, rater_id, rating, comment)
  values (p_order_id, v_uid, p_rating, v_comment)
  on conflict (order_id, rater_id) do update
    set
      rating = excluded.rating,
      comment = excluded.comment,
      updated_at = now();

  v_rating_upserted := true;

  if v_order.driver_id is not null then
    begin
      insert into public.driver_ratings (
        order_id,
        ratee_driver_id,
        rater_user_id,
        rater_id,
        rating,
        comment,
        source_type,
        source_id,
        taxi_ride_id
      )
      values (
        p_order_id,
        v_order.driver_id,
        v_uid,
        v_uid,
        p_rating,
        v_comment,
        case
          when lower(coalesce(v_order.external_ref_type, '')) = 'delivery_request'
            then 'delivery_request'
          else 'food_order'
        end,
        coalesce(v_order.external_ref_id, p_order_id),
        null
      )
      on conflict (order_id) do nothing;
      v_driver_rating_upserted := true;
      perform public.refresh_driver_rating(v_order.driver_id);
    exception
      when unique_violation then
        v_driver_rating_upserted := false;
      when others then
        v_driver_rating_upserted := false;
    end;
  end if;

  if v_tip > 0 then
    if coalesce(v_order.tip_cents, 0) > 0 then
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
    'driver_rated', v_driver_rating_upserted,
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

comment on function public.submit_order_review_and_tip(uuid, integer, text, integer) is
  'Food/package order review: order_ratings (restaurant/order) + driver_ratings when driver assigned; tip_cents without rewriting paid totals.';

commit;