-- Phase 10.1: cast sum(delta_points) to integer for mmd_loyalty_reverse → mmd_loyalty_accrue.
-- Empty-DB resets already get the fix via 20260827121000; this covers incremental DBs.

create or replace function public.mmd_loyalty_reverse(
  p_reference_type text,
  p_reference_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_reversed integer := 0;
begin
  if p_reference_type is null or p_reference_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  for v_row in
    select user_id, role, sum(delta_points) as net_points
    from public.loyalty_ledger
    where reference_type = p_reference_type
      and reference_id = p_reference_id
      and entry_type in ('order', 'taxi')
      group by user_id, role
    having sum(delta_points) > 0
  loop
    perform public.mmd_loyalty_accrue(
      v_row.user_id,
      (-v_row.net_points)::integer,
      'admin_adjust',
      p_reference_type,
      p_reference_id,
      'reverse:' || p_reference_type || ':' || p_reference_id || ':' || v_row.role || ':' || v_row.user_id::text,
      coalesce(p_reason, 'Annulation/remboursement — reprise des points'),
      null,
      jsonb_build_object(
        'reversal', true,
        'underflow',
        (coalesce((select points_balance from public.loyalty_accounts
          where user_id = v_row.user_id and role = v_row.role), 0)
          < v_row.net_points)
      ),
      v_row.role
    );
    v_reversed := v_reversed + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reversed_accounts', v_reversed);
end;
$$;
