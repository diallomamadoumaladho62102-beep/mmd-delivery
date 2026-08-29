-- Distributed API rate limit for multi-instance Vercel (service_role only).

create table if not exists public.api_rate_limit_hits (
  id bigserial primary key,
  namespace text not null,
  rate_key text not null,
  hit_at timestamptz not null default now()
);

create index if not exists api_rate_limit_hits_ns_key_hit_idx
  on public.api_rate_limit_hits (namespace, rate_key, hit_at desc);

alter table public.api_rate_limit_hits enable row level security;

create or replace function public.check_api_rate_limit(
  p_namespace text,
  p_key text,
  p_window_ms bigint,
  p_max_hits integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_ms bigint := greatest(coalesce(p_window_ms, 60000), 1000);
  v_max integer := greatest(coalesce(p_max_hits, 20), 1);
  v_namespace text := left(trim(coalesce(p_namespace, '')), 80);
  v_key text := left(trim(coalesce(p_key, '')), 200);
  v_window_start timestamptz := now() - make_interval(secs => (v_window_ms::double precision / 1000.0));
  v_count integer;
  v_oldest timestamptz;
  v_retry_after integer;
begin
  if v_namespace = '' or v_key = '' then
    return jsonb_build_object('allowed', false, 'retry_after', 60);
  end if;

  delete from public.api_rate_limit_hits
  where namespace = v_namespace
    and rate_key = v_key
    and hit_at < v_window_start;

  select count(*)::integer, min(hit_at)
  into v_count, v_oldest
  from public.api_rate_limit_hits
  where namespace = v_namespace
    and rate_key = v_key
    and hit_at >= v_window_start;

  if coalesce(v_count, 0) >= v_max then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_oldest + make_interval(secs => (v_window_ms::double precision / 1000.0)) - now())))::integer
    );
    return jsonb_build_object('allowed', false, 'retry_after', v_retry_after);
  end if;

  insert into public.api_rate_limit_hits (namespace, rate_key, hit_at)
  values (v_namespace, v_key, now());

  return jsonb_build_object('allowed', true, 'retry_after', null);
end;
$$;

revoke all on function public.check_api_rate_limit(text, text, bigint, integer) from public;
revoke all on function public.check_api_rate_limit(text, text, bigint, integer) from anon;
revoke all on function public.check_api_rate_limit(text, text, bigint, integer) from authenticated;
grant execute on function public.check_api_rate_limit(text, text, bigint, integer) to service_role;
