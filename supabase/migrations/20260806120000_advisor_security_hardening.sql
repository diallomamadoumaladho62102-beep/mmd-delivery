-- Advisor security hardening (production-safe):
-- 1) Fix ERROR: RLS disabled on public.taxi_preference_stats
-- 2) Close Suggestions: RLS enabled without policies on 7 tables
-- 3) Freeze search_path on public functions missing it
-- 4) Revoke anon/PUBLIC EXECUTE on SECURITY DEFINER functions
--
-- No financial data mutation. service_role continues to bypass RLS.
-- Rollback notes: docs/production/SUPABASE_ADVISOR_FINAL_AUDIT.md
-- Empty-DB safe: policy blocks skip when target relation is absent.

begin;

-- ---------------------------------------------------------------------------
-- 1) ERROR — taxi_preference_stats
-- ---------------------------------------------------------------------------

do $taxi_pref$
begin
  if to_regclass('public.taxi_preference_stats') is null then
    return;
  end if;

  alter table public.taxi_preference_stats enable row level security;

  drop policy if exists taxi_preference_stats_staff_select on public.taxi_preference_stats;
  create policy taxi_preference_stats_staff_select
    on public.taxi_preference_stats
    for select
    to authenticated
    using (public.is_staff_user(auth.uid()));

  drop policy if exists taxi_preference_stats_staff_write on public.taxi_preference_stats;
  create policy taxi_preference_stats_staff_write
    on public.taxi_preference_stats
    for all
    to authenticated
    using (public.is_staff_user(auth.uid()))
    with check (public.is_staff_user(auth.uid()));
end;
$taxi_pref$;

-- ---------------------------------------------------------------------------
-- 2) Suggestions — tables with RLS on and zero policies
-- ---------------------------------------------------------------------------

do $policies$
begin
  if to_regclass('public.commission_settings') is not null then
    drop policy if exists commission_settings_staff_select on public.commission_settings;
    create policy commission_settings_staff_select
      on public.commission_settings
      for select
      to authenticated
      using (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.driver_reward_accounts') is not null then
    drop policy if exists driver_reward_accounts_select_own on public.driver_reward_accounts;
    create policy driver_reward_accounts_select_own
      on public.driver_reward_accounts
      for select
      to authenticated
      using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

    drop policy if exists driver_reward_accounts_staff_write on public.driver_reward_accounts;
    create policy driver_reward_accounts_staff_write
      on public.driver_reward_accounts
      for all
      to authenticated
      using (public.is_staff_user(auth.uid()))
      with check (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.driver_reward_history') is not null then
    drop policy if exists driver_reward_history_select_own on public.driver_reward_history;
    create policy driver_reward_history_select_own
      on public.driver_reward_history
      for select
      to authenticated
      using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

    drop policy if exists driver_reward_history_staff_write on public.driver_reward_history;
    create policy driver_reward_history_staff_write
      on public.driver_reward_history
      for all
      to authenticated
      using (public.is_staff_user(auth.uid()))
      with check (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.notification_logs') is not null then
    drop policy if exists notification_logs_staff_select on public.notification_logs;
    create policy notification_logs_staff_select
      on public.notification_logs
      for select
      to authenticated
      using (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.payment_webhook_events') is not null then
    drop policy if exists payment_webhook_events_staff_select on public.payment_webhook_events;
    create policy payment_webhook_events_staff_select
      on public.payment_webhook_events
      for select
      to authenticated
      using (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.taxi_business_ride_policies') is not null then
    drop policy if exists taxi_business_ride_policies_member_select
      on public.taxi_business_ride_policies;
    create policy taxi_business_ride_policies_member_select
      on public.taxi_business_ride_policies
      for select
      to authenticated
      using (
        public.is_staff_user(auth.uid())
        or exists (
          select 1
          from public.taxi_business_members m
          where m.business_account_id = taxi_business_ride_policies.business_account_id
            and m.user_id = auth.uid()
            and m.active = true
        )
      );

    drop policy if exists taxi_business_ride_policies_staff_write
      on public.taxi_business_ride_policies;
    create policy taxi_business_ride_policies_staff_write
      on public.taxi_business_ride_policies
      for all
      to authenticated
      using (public.is_staff_user(auth.uid()))
      with check (public.is_staff_user(auth.uid()));
  end if;

  if to_regclass('public.taxi_shared_ride_matches') is not null then
    drop policy if exists taxi_shared_ride_matches_staff_select
      on public.taxi_shared_ride_matches;
    create policy taxi_shared_ride_matches_staff_select
      on public.taxi_shared_ride_matches
      for select
      to authenticated
      using (
        public.is_staff_user(auth.uid())
        or exists (
          select 1
          from public.taxi_rides tr
          where tr.id = taxi_shared_ride_matches.candidate_taxi_ride_id
            and (tr.client_user_id = auth.uid() or tr.driver_id = auth.uid())
        )
      );

    drop policy if exists taxi_shared_ride_matches_staff_write
      on public.taxi_shared_ride_matches;
    create policy taxi_shared_ride_matches_staff_write
      on public.taxi_shared_ride_matches
      for all
      to authenticated
      using (public.is_staff_user(auth.uid()))
      with check (public.is_staff_user(auth.uid()));
  end if;
end;
$policies$;

-- ---------------------------------------------------------------------------
-- 3) Freeze search_path on public functions that lack it
-- ---------------------------------------------------------------------------

do $sp$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as regproc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
      and (
        p.proconfig is null
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) cfg
          where cfg like 'search_path=%'
        )
      )
  loop
    begin
      execute format('alter function %s set search_path to public', r.regproc);
    exception
      when insufficient_privilege then
        raise notice 'skip search_path on % (not owner)', r.regproc;
    end;
  end loop;
end
$sp$;

-- ---------------------------------------------------------------------------
-- 4) Revoke client anon / PUBLIC execute on SECURITY DEFINER functions
-- Keep authenticated for intentional RPCs; strip authenticated from trigger-like
-- internals that must not be called as RPC.
-- ---------------------------------------------------------------------------

do $sec$
declare
  r record;
  fname text;
  strip_authenticated boolean;
begin
  for r in
    select
      p.oid::regprocedure as regproc,
      p.proname as fname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.prokind = 'f'
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    fname := r.fname;
    begin
      execute format('revoke all on function %s from public', r.regproc);
      execute format('revoke all on function %s from anon', r.regproc);
      execute format('grant execute on function %s to service_role', r.regproc);
    exception
      when insufficient_privilege then
        raise notice 'skip revoke/grant on % (not owner)', r.regproc;
        continue;
    end;

    strip_authenticated :=
      fname like 'trigger_%'
      or fname like 'trg_%'
      or fname like 'notify_%'
      or fname like 'award_%'
      or fname like 'expire_%'
      or fname like 'auto_%'
      or fname like 'retry_%'
      or fname like 'guard_%'
      or fname like 'touch_%'
      or fname like 'set_%updated_at%'
      or fname like '%_set_updated_at';

    begin
      if strip_authenticated then
        execute format('revoke all on function %s from authenticated', r.regproc);
      else
        execute format('grant execute on function %s to authenticated', r.regproc);
      end if;
    exception
      when insufficient_privilege then
        raise notice 'skip authenticated acl on % (not owner)', r.regproc;
    end;
  end loop;
end
$sec$;

commit;
