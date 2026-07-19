-- Phase 8 — Analytics & Business Intelligence Center
-- Read-only consumer of existing engines. Do not apply to Production from this chat.

-- ---------------------------------------------------------------------------
-- 1) Card catalog
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_card_catalog (
  key text primary key,
  module text not null,
  label text not null,
  description text,
  metric_key text not null,
  format text not null default 'number',
  default_visible boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Per-admin dashboard preferences
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_dashboard_prefs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles (id) on delete cascade,
  module text not null default 'global',
  visible_cards text[] not null default '{}'::text[],
  card_order text[] not null default '{}'::text[],
  refresh_seconds integer not null default 60,
  filters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint analytics_dashboard_prefs_uq unique (admin_user_id, module)
);

-- ---------------------------------------------------------------------------
-- 3) Daily metric snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  country_code text not null default '',
  city text not null default '',
  service text not null default 'all',
  module text not null default 'global',
  metrics jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  engine_version text not null default 'analytics_v1',
  constraint analytics_daily_metrics_uq unique (
    metric_date, country_code, city, service, module
  )
);

create index if not exists analytics_daily_metrics_date_idx
  on public.analytics_daily_metrics (metric_date desc, module, service);

-- ---------------------------------------------------------------------------
-- 4) Export / sensitive access audit
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  module text,
  format text,
  filters jsonb not null default '{}'::jsonb,
  row_count integer,
  correlation_id text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_audit_admin_idx
  on public.analytics_audit (admin_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Seed cards
-- ---------------------------------------------------------------------------
insert into public.analytics_card_catalog (key, module, label, metric_key, format, sort_order) values
  ('orders_today', 'global', 'Commandes aujourd''hui', 'orders_today', 'number', 10),
  ('orders_week', 'global', 'Commandes semaine', 'orders_week', 'number', 20),
  ('orders_month', 'global', 'Commandes mois', 'orders_month', 'number', 30),
  ('gmv_cents', 'global', 'GMV', 'gmv_cents', 'currency_cents', 40),
  ('revenue_cents', 'global', 'Chiffre d''affaires', 'revenue_cents', 'currency_cents', 50),
  ('commissions_cents', 'global', 'Commissions', 'commissions_cents', 'currency_cents', 60),
  ('mmd_revenue_cents', 'global', 'Revenus MMD', 'mmd_revenue_cents', 'currency_cents', 70),
  ('users_total', 'global', 'Utilisateurs', 'users_total', 'number', 80),
  ('users_new', 'global', 'Nouveaux utilisateurs', 'users_new', 'number', 90),
  ('clients_active', 'global', 'Clients actifs', 'clients_active', 'number', 100),
  ('drivers_active', 'global', 'Chauffeurs actifs', 'drivers_active', 'number', 110),
  ('restaurants_active', 'global', 'Restaurants actifs', 'restaurants_active', 'number', 120),
  ('sellers_active', 'global', 'Vendeurs actifs', 'sellers_active', 'number', 130),
  ('orders_canceled', 'global', 'Commandes annulées', 'orders_canceled', 'number', 140),
  ('cancel_rate', 'global', 'Taux d''annulation', 'cancel_rate', 'percent', 150),
  ('avg_delivery_sec', 'global', 'Temps moyen livraison', 'avg_delivery_sec', 'duration_sec', 160),
  ('avg_taxi_sec', 'global', 'Temps moyen Taxi', 'avg_taxi_sec', 'duration_sec', 170),
  ('avg_basket_cents', 'global', 'Panier moyen', 'avg_basket_cents', 'currency_cents', 180),
  ('cashback_cents', 'global', 'Cashback distribué', 'cashback_cents', 'currency_cents', 190),
  ('loyalty_points', 'global', 'Points fidélité', 'loyalty_points', 'number', 200),
  ('mmd_plus_active', 'global', 'Abonnés MMD+', 'mmd_plus_active', 'number', 210),
  ('campaigns_active', 'global', 'Campagnes actives', 'campaigns_active', 'number', 220),
  ('food_orders', 'food', 'Commandes Food', 'orders', 'number', 10),
  ('food_sales', 'food', 'Ventes Food', 'sales_cents', 'currency_cents', 20),
  ('food_cancel', 'food', 'Annulations', 'canceled', 'number', 40),
  ('food_commission', 'food', 'Commissions', 'commissions_cents', 'currency_cents', 60),
  ('delivery_count', 'delivery', 'Livraisons', 'deliveries', 'number', 10),
  ('delivery_revenue', 'delivery', 'Revenus', 'revenue_cents', 'currency_cents', 30),
  ('taxi_rides', 'taxi', 'Courses', 'rides', 'number', 10),
  ('taxi_revenue', 'taxi', 'Revenus', 'revenue_cents', 'currency_cents', 40),
  ('taxi_cancel', 'taxi', 'Taux annulation', 'cancel_rate', 'percent', 60),
  ('mp_orders', 'marketplace', 'Commandes', 'orders', 'number', 10),
  ('mp_gmv', 'marketplace', 'GMV', 'gmv_cents', 'currency_cents', 20),
  ('loy_issued', 'loyalty', 'Points distribués', 'points_issued', 'number', 10),
  ('loy_redeemed', 'loyalty', 'Points utilisés', 'points_redeemed', 'number', 20),
  ('plus_active', 'mmd_plus', 'Abonnements actifs', 'active', 'number', 10),
  ('plus_mrr', 'mmd_plus', 'MRR', 'mrr_cents', 'currency_cents', 30),
  ('plus_churn', 'mmd_plus', 'Churn', 'churn_rate', 'percent', 40),
  ('mkt_campaigns', 'marketing', 'Campagnes', 'campaigns', 'number', 10),
  ('mkt_budget', 'marketing', 'Budget consommé', 'budget_spent_cents', 'currency_cents', 20),
  ('mkt_cashback', 'marketing', 'Cashback', 'cashback_cents', 'currency_cents', 30),
  ('fin_revenue', 'finance', 'Revenus', 'revenue_cents', 'currency_cents', 10),
  ('fin_payouts', 'finance', 'Payouts', 'payouts_cents', 'currency_cents', 20),
  ('fin_refunds', 'finance', 'Remboursements', 'refunds_cents', 'currency_cents', 30),
  ('drv_active', 'drivers', 'Chauffeurs actifs', 'active', 'number', 10),
  ('drv_earnings', 'drivers', 'Revenus', 'earnings_cents', 'currency_cents', 20),
  ('rest_sales', 'restaurants', 'Ventes', 'sales_cents', 'currency_cents', 10),
  ('sell_sales', 'sellers', 'Ventes', 'sales_cents', 'currency_cents', 10),
  ('fraud_suspects', 'fraud', 'Comptes suspects', 'suspect_accounts', 'number', 10),
  ('fraud_cashback', 'fraud', 'Cashback suspect', 'suspect_cashback', 'number', 20)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6) Lightweight daily views (best-effort; app fails open if columns differ)
-- ---------------------------------------------------------------------------
create or replace view public.v_analytics_taxi_paid_daily as
select
  (coalesce(r.paid_at, r.created_at))::date as metric_date,
  upper(coalesce(nullif(trim(r.country_code), ''), '')) as country_code,
  coalesce(nullif(trim(r.pickup_city), ''), '') as city,
  count(*)::integer as rides_count,
  coalesce(sum(r.total_cents), 0)::bigint as revenue_cents,
  coalesce(sum(r.distance_miles), 0)::numeric as distance_miles,
  coalesce(avg(r.duration_minutes), 0)::numeric as avg_duration_min,
  count(*) filter (where lower(coalesce(r.status, '')) like '%cancel%')::integer as canceled_count
from public.taxi_rides r
group by 1, 2, 3;

create or replace view public.v_analytics_marketplace_paid_daily as
select
  (coalesce(s.paid_at, s.created_at))::date as metric_date,
  upper(coalesce(nullif(trim(s.country_code), ''), '')) as country_code,
  count(*)::integer as orders_count,
  coalesce(sum(s.total_cents), 0)::bigint as gmv_cents,
  count(distinct s.seller_id)::integer as sellers_count
from public.seller_orders s
group by 1, 2;

-- ---------------------------------------------------------------------------
-- 7) Refresh daily snapshots (service_role)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_analytics_refresh_daily(
  p_day date default (timezone('utc', now()))::date,
  p_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (timezone('utc', now()))::date);
  v_country text := coalesce(nullif(upper(trim(coalesce(p_country_code, ''))), ''), '');
  v_metrics jsonb := '{}'::jsonb;
  v_food_orders integer := 0;
  v_food_gmv bigint := 0;
  v_food_cancel integer := 0;
  v_del_orders integer := 0;
  v_del_gmv bigint := 0;
  v_taxi_rides integer := 0;
  v_taxi_gmv bigint := 0;
  v_taxi_cancel integer := 0;
  v_mp_orders integer := 0;
  v_mp_gmv bigint := 0;
  v_cashback bigint := 0;
  v_mmd_plus integer := 0;
  v_campaigns integer := 0;
  v_commissions bigint := 0;
  v_payouts bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  begin
    select
      count(*)::integer,
      coalesce(sum(coalesce(total_cents, 0)), 0)::bigint,
      count(*) filter (where lower(coalesce(status, '')) in ('canceled', 'cancelled'))::integer
    into v_food_orders, v_food_gmv, v_food_cancel
    from public.orders
    where created_at::date = v_day;
  exception when others then
    v_food_orders := 0; v_food_gmv := 0; v_food_cancel := 0;
  end;

  begin
    select
      count(*)::integer,
      coalesce(sum(coalesce(total_cents, 0)), 0)::bigint
    into v_del_orders, v_del_gmv
    from public.delivery_requests
    where created_at::date = v_day;
  exception when others then
    v_del_orders := 0; v_del_gmv := 0;
  end;

  begin
    select
      count(*)::integer,
      coalesce(sum(coalesce(total_cents, 0)), 0)::bigint,
      count(*) filter (where lower(coalesce(status, '')) like '%cancel%')::integer
    into v_taxi_rides, v_taxi_gmv, v_taxi_cancel
    from public.taxi_rides
    where created_at::date = v_day
      and (v_country = '' or upper(coalesce(country_code, '')) = v_country);
  exception when others then
    v_taxi_rides := 0; v_taxi_gmv := 0; v_taxi_cancel := 0;
  end;

  begin
    select
      count(*)::integer,
      coalesce(sum(coalesce(total_cents, 0)), 0)::bigint
    into v_mp_orders, v_mp_gmv
    from public.seller_orders
    where created_at::date = v_day
      and (v_country = '' or upper(coalesce(country_code, '')) = v_country);
  exception when others then
    v_mp_orders := 0; v_mp_gmv := 0;
  end;

  begin
    select coalesce(sum(greatest(amount_cents, 0)), 0)::bigint into v_cashback
    from public.marketing_cashback_ledger
    where status = 'credited' and coalesce(credited_at, created_at)::date = v_day;
  exception when others then
    v_cashback := 0;
  end;

  begin
    select count(*)::integer into v_mmd_plus
    from public.mmd_plus_subscriptions where status in ('active', 'trialing');
  exception when others then
    v_mmd_plus := 0;
  end;

  begin
    select count(*)::integer into v_campaigns
    from public.marketing_campaigns where status = 'active';
  exception when others then
    v_campaigns := 0;
  end;

  begin
    select coalesce(sum(platform_fee_cents), 0)::bigint into v_commissions
    from public.order_commissions where created_at::date = v_day;
  exception when others then
    v_commissions := 0;
  end;

  begin
    select coalesce(sum(amount_cents), 0)::bigint into v_payouts
    from public.payout_transactions
    where created_at::date = v_day
      and status in ('paid', 'completed', 'succeeded');
  exception when others then
    v_payouts := 0;
  end;

  v_metrics := jsonb_build_object(
    'orders_today', v_food_orders + v_del_orders + v_taxi_rides + v_mp_orders,
    'gmv_cents', v_food_gmv + v_del_gmv + v_taxi_gmv + v_mp_gmv,
    'revenue_cents', v_food_gmv + v_del_gmv + v_taxi_gmv + v_mp_gmv,
    'commissions_cents', v_commissions,
    'mmd_revenue_cents', v_commissions,
    'cashback_cents', v_cashback,
    'mmd_plus_active', v_mmd_plus,
    'campaigns_active', v_campaigns,
    'payouts_cents', v_payouts,
    'orders_canceled', v_food_cancel + v_taxi_cancel,
    'cancel_rate', case
      when (v_food_orders + v_taxi_rides) > 0
      then round(100.0 * (v_food_cancel + v_taxi_cancel) / greatest(v_food_orders + v_taxi_rides, 1), 2)
      else 0
    end,
    'food_orders', v_food_orders,
    'delivery_orders', v_del_orders,
    'taxi_rides', v_taxi_rides,
    'marketplace_orders', v_mp_orders
  );

  insert into public.analytics_daily_metrics as adm (
    metric_date, country_code, city, service, module, metrics, computed_at
  ) values
    (v_day, v_country, '', 'all', 'global', v_metrics, now()),
    (v_day, v_country, '', 'food', 'food', jsonb_build_object(
      'orders', v_food_orders, 'sales_cents', v_food_gmv, 'canceled', v_food_cancel, 'gmv_cents', v_food_gmv
    ), now()),
    (v_day, v_country, '', 'delivery', 'delivery', jsonb_build_object(
      'deliveries', v_del_orders, 'revenue_cents', v_del_gmv
    ), now()),
    (v_day, v_country, '', 'taxi', 'taxi', jsonb_build_object(
      'rides', v_taxi_rides, 'revenue_cents', v_taxi_gmv, 'canceled', v_taxi_cancel,
      'cancel_rate', case when v_taxi_rides > 0 then round(100.0 * v_taxi_cancel / v_taxi_rides, 2) else 0 end
    ), now()),
    (v_day, v_country, '', 'marketplace', 'marketplace', jsonb_build_object(
      'orders', v_mp_orders, 'gmv_cents', v_mp_gmv
    ), now())
  on conflict (metric_date, country_code, city, service, module)
  do update set metrics = excluded.metrics, computed_at = now();

  return jsonb_build_object('ok', true, 'day', v_day, 'metrics', v_metrics);
end;
$$;

revoke all on function public.mmd_analytics_refresh_daily(date, text) from public, anon, authenticated;
grant execute on function public.mmd_analytics_refresh_daily(date, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
alter table public.analytics_card_catalog enable row level security;
alter table public.analytics_dashboard_prefs enable row level security;
alter table public.analytics_daily_metrics enable row level security;
alter table public.analytics_audit enable row level security;

drop policy if exists analytics_card_catalog_select on public.analytics_card_catalog;
create policy analytics_card_catalog_select
on public.analytics_card_catalog for select to authenticated using (true);

drop policy if exists analytics_prefs_own on public.analytics_dashboard_prefs;
create policy analytics_prefs_own
on public.analytics_dashboard_prefs for all to authenticated
using (admin_user_id = auth.uid())
with check (admin_user_id = auth.uid());

drop policy if exists analytics_metrics_select on public.analytics_daily_metrics;
create policy analytics_metrics_select
on public.analytics_daily_metrics for select to authenticated using (true);

drop policy if exists analytics_audit_select on public.analytics_audit;
create policy analytics_audit_select
on public.analytics_audit for select to authenticated
using (admin_user_id = auth.uid());

grant select on public.v_analytics_taxi_paid_daily to authenticated, service_role;
grant select on public.v_analytics_marketplace_paid_daily to authenticated, service_role;
