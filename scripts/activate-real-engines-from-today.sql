-- Manual activation ONLY after PR + MAIN CI + production smoke PASS.
-- Sets engine_start_at = now() for Minimum Pay and Driver Integrity.
-- Completes already-approved period settings. Does NOT invent a pay rule / hourly MPR.
-- Does NOT backfill. Does NOT rewrite engine_start_at if already set.
-- Does NOT delete Stripe or live rows.

update public.minimum_pay_engine_settings
set
  mode = 'active',
  engine_start_at = now(),
  timezone = coalesce(nullif(btrim(timezone), ''), 'America/New_York'),
  period_length_days = coalesce(period_length_days, 7),
  period_start_weekday = coalesce(period_start_weekday, 1),
  default_jurisdiction = coalesce(nullif(btrim(default_jurisdiction), ''), 'nyc'),
  default_method = coalesce(nullif(btrim(default_method), ''), 'standard'),
  default_rounding = coalesce(nullif(btrim(default_rounding), ''), 'half_up_cents'),
  default_currency = coalesce(nullif(btrim(default_currency), ''), 'USD'),
  eligible_source_types = case
    when coalesce(cardinality(eligible_source_types), 0) = 0 then array['delivery_share']::text[]
    else eligible_source_types
  end,
  eligible_county_codes = case
    when coalesce(cardinality(eligible_county_codes), 0) = 0 then array['nyc']::text[]
    else eligible_county_codes
  end,
  transfers_enabled = true,
  updated_at = now()
where singleton = true
  and engine_start_at is null;

update public.driver_integrity_settings
set
  monitoring_enabled = true,
  warning_notifications_enabled = true,
  reassignment_enabled = true,
  contact_enabled = true,
  review_enabled = true,
  sanction_workflow_enabled = true,
  engine_start_at = now(),
  updated_at = now()
where singleton = true
  and engine_start_at is null;
