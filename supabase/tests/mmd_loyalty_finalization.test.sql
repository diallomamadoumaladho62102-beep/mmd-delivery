-- ===========================================================================
-- MMD Loyalty — real SQL tests (run against dev / Preview, NOT Production).
-- ---------------------------------------------------------------------------
-- Safe by construction: the whole script runs in a transaction that is ROLLED
-- BACK at the end, so it never mutates environment data. Any failed assertion
-- raises an exception (which also aborts + rolls back).
--
-- Usage (Supabase/psql against the Preview DB):
--   psql "$PREVIEW_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/mmd_loyalty_finalization.test.sql
--
-- If your `profiles` table has additional NOT NULL columns, extend the two
-- INSERTs below accordingly. Everything else is schema-driven.
-- ===========================================================================

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  r jsonb;
  v_bal integer;
  v_credit bigint;
begin
  -- Ensure the program is enabled with deterministic settings for the test.
  update public.loyalty_settings
    set enabled = true, points_per_delivery = 1, points_per_ride = 1,
        conversion_points = 100, conversion_credit_cents = 500,
        credit_validity_months = 6
  where singleton = true;

  -- Auth users required by profiles_id_fkey (rolled back with the transaction).
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'loyalty-u1-' || u1::text || '@example.com', crypt('x', gen_salt('bf')),
     now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'loyalty-u2-' || u2::text || '@example.com', crypt('x', gen_salt('bf')),
     now(), '{}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, role) values (u1, 'client'), (u2, 'client')
  on conflict (id) do update set role = excluded.role;

  -- 1) Account creation ------------------------------------------------------
  perform public.mmd_loyalty_ensure_account(u1, 'client');
  if not exists (
    select 1 from public.loyalty_accounts where user_id = u1 and role = 'client'
  ) then
    raise exception 'FAIL account creation';
  end if;

  -- 2) Points attribution ----------------------------------------------------
  r := public.mmd_loyalty_accrue(u1, 120, 'order', 'food_order', 'test-o1', 'idem-o1');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL accrue: %', r; end if;
  select points_balance into v_bal
  from public.loyalty_accounts where user_id = u1 and role = 'client';
  if v_bal <> 120 then raise exception 'FAIL accrue balance = %', v_bal; end if;

  -- 3) Same idempotency_key must NOT double-award -----------------------------
  r := public.mmd_loyalty_accrue(u1, 120, 'order', 'food_order', 'test-o1', 'idem-o1');
  select points_balance into v_bal
  from public.loyalty_accounts where user_id = u1 and role = 'client';
  if v_bal <> 120 then raise exception 'FAIL idempotent accrue balance = %', v_bal; end if;

  -- 4) Convert 100 points -> 500 cents ---------------------------------------
  r := public.mmd_convert_points(u1, 1, 'conv-1');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL convert: %', r; end if;
  select points_balance into v_bal
  from public.loyalty_accounts where user_id = u1 and role = 'client';
  if v_bal <> 20 then raise exception 'FAIL post-convert points = %', v_bal; end if;
  select balance_cents into v_credit from public.mmd_credit_wallets where user_id = u1;
  if v_credit <> 500 then raise exception 'FAIL post-convert credit = %', v_credit; end if;

  -- 5) Insufficient balance refused ------------------------------------------
  r := public.mmd_convert_points(u1, 1, 'conv-2');
  if (r->>'error') <> 'insufficient_points' then raise exception 'FAIL insufficient: %', r; end if;

  -- 6) Add credit + reserve/capture (spend) ----------------------------------
  r := public.mmd_credit_add(u1, 1000, 'admin_adjust', 'admin', null, 'add-1', null, 'test add', null);
  if (r->>'ok')::boolean is not true then raise exception 'FAIL credit add: %', r; end if;
  -- available = balance - held
  r := public.mmd_credit_reserve(u1, 'food_order', 'ent-1', 400, 400, 'USD');
  if (r->>'ok')::boolean is not true or (r->>'amount_cents')::int <> 400 then
    raise exception 'FAIL reserve: %', r;
  end if;
  if public.mmd_credit_available_cents(u1) <> 1100 then -- 1500 - 400 held
    raise exception 'FAIL available after reserve = %', public.mmd_credit_available_cents(u1);
  end if;
  r := public.mmd_credit_capture('food_order', 'ent-1');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL capture: %', r; end if;
  select balance_cents into v_credit from public.mmd_credit_wallets where user_id = u1;
  if v_credit <> 1100 then raise exception 'FAIL post-capture credit = %', v_credit; end if;
  -- double capture is a no-op
  r := public.mmd_credit_capture('food_order', 'ent-1');
  select balance_cents into v_credit from public.mmd_credit_wallets where user_id = u1;
  if v_credit <> 1100 then raise exception 'FAIL double capture changed balance = %', v_credit; end if;

  -- 7) Release only works before capture -------------------------------------
  r := public.mmd_credit_reserve(u1, 'taxi_ride', 'ent-2', 200, 200, 'USD');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL reserve2: %', r; end if;
  r := public.mmd_credit_release('taxi_ride', 'ent-2');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL release: %', r; end if;
  if public.mmd_credit_available_cents(u1) <> 1100 then
    raise exception 'FAIL available after release = %', public.mmd_credit_available_cents(u1);
  end if;

  -- 8) Currency mismatch refused ---------------------------------------------
  r := public.mmd_credit_reserve(u1, 'food_order', 'ent-3', 100, 100, 'EUR');
  if (r->>'error') <> 'currency_mismatch' then raise exception 'FAIL currency guard: %', r; end if;

  -- 9) Lot expiry ------------------------------------------------------------
  update public.mmd_credit_lots set expires_at = now() - interval '1 day'
    where user_id = u1 and remaining_cents > 0;
  r := public.mmd_credit_expire_due_batch(500);
  select balance_cents into v_credit from public.mmd_credit_wallets where user_id = u1;
  if v_credit <> 0 then raise exception 'FAIL post-expiry credit = %', v_credit; end if;

  -- 10) Refund reversal of points (compensating entry, never delete) ---------
  r := public.mmd_loyalty_reverse('food_order', 'test-o1', 'refund test');
  if (r->>'ok')::boolean is not true then raise exception 'FAIL reverse: %', r; end if;
  select points_balance into v_bal
  from public.loyalty_accounts where user_id = u1 and role = 'client';
  if v_bal <> 0 then raise exception 'FAIL post-reverse points = %', v_bal; end if;
  if (select count(*) from public.loyalty_ledger where reference_id = 'test-o1') < 2 then
    raise exception 'FAIL reverse did not append a compensating ledger entry';
  end if;

  -- 11) Referral: apply, self-referral refused, double-reward refused --------
  perform public.mmd_loyalty_get_or_create_code(u1, 'client');
  declare v_code text;
  begin
    select code into v_code from public.loyalty_referral_codes
    where user_id = u1 and role = 'client';
    -- self referral refused
    r := public.mmd_loyalty_apply_referral_code(u1, v_code, 'client');
    if (r->>'error') <> 'self_referral' then raise exception 'FAIL self referral: %', r; end if;
    -- u2 applies u1 code
    r := public.mmd_loyalty_apply_referral_code(u2, v_code, 'client');
    if (r->>'ok')::boolean is not true then raise exception 'FAIL apply referral: %', r; end if;
    -- second apply refused (already referred)
    r := public.mmd_loyalty_apply_referral_code(u2, v_code, 'client');
    if (r->>'error') <> 'already_referred' then raise exception 'FAIL double referral: %', r; end if;
    -- process referral rewards both, once
    r := public.mmd_process_referral(u2);
    if (r->>'ok')::boolean is not true then raise exception 'FAIL process referral: %', r; end if;
    r := public.mmd_process_referral(u2); -- idempotent
    if (r->>'no_pending')::boolean is not true then raise exception 'FAIL referral not idempotent: %', r; end if;
  end;

  raise notice 'ALL MMD LOYALTY FINALIZATION SQL TESTS PASSED';
end
$$;

rollback;
