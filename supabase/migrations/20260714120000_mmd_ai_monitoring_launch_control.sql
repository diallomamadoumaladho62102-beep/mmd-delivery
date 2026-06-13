-- MMD AI Phase 1.5 — monitoring, launch control, distributed rate limit

begin;

-- ---------------------------------------------------------------------------
-- 1) Launch control columns on platform scope tables
-- ---------------------------------------------------------------------------

alter table public.platform_countries
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_enabled_updated_at timestamptz,
  add column if not exists ai_enabled_updated_by uuid references public.profiles (id) on delete set null;

alter table public.platform_regions
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_enabled_updated_at timestamptz,
  add column if not exists ai_enabled_updated_by uuid references public.profiles (id) on delete set null;

create index if not exists platform_countries_ai_enabled_idx
  on public.platform_countries (ai_enabled, country_code)
  where ai_enabled = true;

create index if not exists platform_regions_ai_enabled_idx
  on public.platform_regions (country_code, region_code, ai_enabled)
  where ai_enabled = true;

-- ---------------------------------------------------------------------------
-- 2) Runtime settings (emergency stop override from Admin)
-- ---------------------------------------------------------------------------

create table if not exists public.ai_runtime_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

insert into public.ai_runtime_settings (key, value)
values
  ('emergency_stop', '{"enabled": false}'::jsonb),
  ('daily_cost_cap_usd', '{"amount": null}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Conversations
-- ---------------------------------------------------------------------------

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  country_code text,
  region_code text,
  state_code text,
  scope_level text,
  scope_source text,
  intent_primary text,
  escalated boolean not null default false,
  message_count integer not null default 0,
  total_prompt_tokens integer not null default 0,
  total_completion_tokens integer not null default 0,
  estimated_cost_usd numeric(14, 8) not null default 0,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index if not exists ai_conversations_user_started_idx
  on public.ai_conversations (user_id, started_at desc);

create index if not exists ai_conversations_started_idx
  on public.ai_conversations (started_at desc);

create index if not exists ai_conversations_country_idx
  on public.ai_conversations (country_code, started_at desc);

-- ---------------------------------------------------------------------------
-- 4) Messages (no message body stored)
-- ---------------------------------------------------------------------------

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_row_id uuid not null references public.ai_conversations (id) on delete cascade,
  conversation_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  message_length integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(14, 8) not null default 0,
  model text,
  tools_used text[] not null default '{}',
  latency_ms integer,
  intent text,
  country_code text,
  region_code text,
  state_code text,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_created_idx
  on public.ai_messages (created_at desc);

create index if not exists ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);

create index if not exists ai_messages_country_created_idx
  on public.ai_messages (country_code, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Structured events
-- ---------------------------------------------------------------------------

create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'mmd_ai_chat',
      'mmd_ai_error',
      'mmd_ai_rate_limit',
      'mmd_ai_escalation',
      'mmd_ai_cost_cap_reached'
    )
  ),
  user_id uuid references public.profiles (id) on delete set null,
  conversation_id text,
  error_code text,
  message_length integer,
  latency_ms integer,
  tools_used text[] not null default '{}',
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  estimated_cost_usd numeric(14, 8) not null default 0,
  country_code text,
  region_code text,
  state_code text,
  intent text,
  created_at timestamptz not null default now()
);

create index if not exists ai_events_type_created_idx
  on public.ai_events (event_type, created_at desc);

create index if not exists ai_events_created_idx
  on public.ai_events (created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Distributed rate limit hits
-- ---------------------------------------------------------------------------

create table if not exists public.ai_rate_limit_hits (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  hit_at timestamptz not null default now()
);

create index if not exists ai_rate_limit_hits_user_hit_idx
  on public.ai_rate_limit_hits (user_id, hit_at desc);

-- ---------------------------------------------------------------------------
-- 7) Rate limit RPC
-- ---------------------------------------------------------------------------

create or replace function public.check_ai_rate_limit(
  p_user_id uuid,
  p_window_ms bigint,
  p_max_hits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_ms bigint := greatest(coalesce(p_window_ms, 600000), 1000);
  v_max integer := greatest(coalesce(p_max_hits, 20), 1);
  v_window_start timestamptz := now() - make_interval(secs => (v_window_ms::double precision / 1000.0));
  v_count integer;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'retry_after', 60);
  end if;

  delete from public.ai_rate_limit_hits
  where user_id = p_user_id and hit_at < v_window_start;

  select count(*)::integer, min(hit_at)
  into v_count, v_oldest
  from public.ai_rate_limit_hits
  where user_id = p_user_id and hit_at >= v_window_start;

  if coalesce(v_count, 0) >= v_max then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_oldest + make_interval(secs => (v_window_ms::double precision / 1000.0)) - now())))::integer
    );
    return jsonb_build_object('allowed', false, 'retry_after', v_retry_after);
  end if;

  insert into public.ai_rate_limit_hits (user_id, hit_at) values (p_user_id, now());

  return jsonb_build_object('allowed', true, 'retry_after', null);
end;
$$;

revoke all on function public.check_ai_rate_limit(uuid, bigint, integer) from public;
grant execute on function public.check_ai_rate_limit(uuid, bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8) Metrics RPC
-- ---------------------------------------------------------------------------

create or replace function public.get_ai_metrics(p_period text default 'today')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_period text := lower(trim(coalesce(p_period, 'today')));
begin
  if v_period = '7d' then
    v_start := now() - interval '7 days';
  elsif v_period = '30d' then
    v_start := now() - interval '30 days';
  else
    v_start := date_trunc('day', now());
    v_period := 'today';
  end if;

  return jsonb_build_object(
    'period', v_period,
    'start_at', v_start,
    'ai_conversations_count', (
      select count(*)::integer from public.ai_conversations where started_at >= v_start
    ),
    'ai_messages_count', (
      select count(*)::integer from public.ai_messages where created_at >= v_start
    ),
    'ai_unique_users', (
      select count(distinct user_id)::integer from public.ai_messages where created_at >= v_start
    ),
    'ai_error_count', (
      select count(*)::integer from public.ai_events
      where created_at >= v_start and event_type = 'mmd_ai_error'
    ),
    'ai_escalation_count', (
      select count(*)::integer from public.ai_events
      where created_at >= v_start and event_type = 'mmd_ai_escalation'
    ),
    'estimated_cost_usd', (
      select coalesce(sum(estimated_cost_usd), 0)::numeric(14, 8)
      from public.ai_messages where created_at >= v_start
    )
  );
end;
$$;

create or replace function public.get_ai_metrics_by_geo(p_period text default 'today')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_period text := lower(trim(coalesce(p_period, 'today')));
begin
  if v_period = '7d' then
    v_start := now() - interval '7 days';
  elsif v_period = '30d' then
    v_start := now() - interval '30 days';
  else
    v_start := date_trunc('day', now());
    v_period := 'today';
  end if;

  return jsonb_build_object(
    'period', v_period,
    'by_country', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          coalesce(country_code, 'unknown') as country_code,
          count(distinct conversation_id)::integer as conversations,
          count(*)::integer as messages,
          coalesce(sum(estimated_cost_usd), 0)::numeric(14, 8) as estimated_cost_usd
        from public.ai_messages
        where created_at >= v_start
        group by 1
        order by messages desc
        limit 50
      ) t
    ), '[]'::jsonb),
    'by_state', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          coalesce(country_code, 'unknown') as country_code,
          coalesce(state_code, region_code, 'unknown') as state_or_region,
          count(distinct conversation_id)::integer as conversations,
          count(*)::integer as messages,
          coalesce(sum(estimated_cost_usd), 0)::numeric(14, 8) as estimated_cost_usd
        from public.ai_messages
        where created_at >= v_start
        group by 1, 2
        order by messages desc
        limit 100
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_ai_top_intents(p_period text default 'today', p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_period text := lower(trim(coalesce(p_period, 'today')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  if v_period = '7d' then
    v_start := now() - interval '7 days';
  elsif v_period = '30d' then
    v_start := now() - interval '30 days';
  else
    v_start := date_trunc('day', now());
    v_period := 'today';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t))
    from (
      select
        coalesce(intent, 'general') as intent,
        count(*)::integer as count
      from public.ai_messages
      where created_at >= v_start and role = 'user'
      group by 1
      order by count desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_ai_daily_cost_usd()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(estimated_cost_usd), 0)::numeric(14, 8)
  from public.ai_messages
  where created_at >= date_trunc('day', now());
$$;

create or replace function public.get_ai_active_regions_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*)::integer from public.platform_countries where ai_enabled = true)
    +
    (select count(*)::integer from public.platform_regions where ai_enabled = true)
  );
$$;

revoke all on function public.get_ai_metrics(text) from public;
revoke all on function public.get_ai_metrics_by_geo(text) from public;
revoke all on function public.get_ai_top_intents(text, integer) from public;
revoke all on function public.get_ai_daily_cost_usd() from public;
revoke all on function public.get_ai_active_regions_count() from public;

grant execute on function public.get_ai_metrics(text) to service_role;
grant execute on function public.get_ai_metrics_by_geo(text) to service_role;
grant execute on function public.get_ai_top_intents(text, integer) to service_role;
grant execute on function public.get_ai_daily_cost_usd() to service_role;
grant execute on function public.get_ai_active_regions_count() to service_role;

-- ---------------------------------------------------------------------------
-- 9) RLS
-- ---------------------------------------------------------------------------

alter table public.ai_runtime_settings enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_events enable row level security;
alter table public.ai_rate_limit_hits enable row level security;

drop policy if exists ai_runtime_settings_staff on public.ai_runtime_settings;
create policy ai_runtime_settings_staff on public.ai_runtime_settings
for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

drop policy if exists ai_conversations_staff_select on public.ai_conversations;
create policy ai_conversations_staff_select on public.ai_conversations
for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists ai_messages_staff_select on public.ai_messages;
create policy ai_messages_staff_select on public.ai_messages
for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists ai_events_staff_select on public.ai_events;
create policy ai_events_staff_select on public.ai_events
for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists ai_rate_limit_hits_staff_select on public.ai_rate_limit_hits;
create policy ai_rate_limit_hits_staff_select on public.ai_rate_limit_hits
for select to authenticated
using (public.is_staff_user(auth.uid()));

commit;
