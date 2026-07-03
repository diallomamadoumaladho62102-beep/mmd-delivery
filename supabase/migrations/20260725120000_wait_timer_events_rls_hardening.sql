-- Harden wait_timer_events and order_events RLS to participant-only reads.

begin;

-- ---------------------------------------------------------------------------
-- wait_timer_events — replace blanket SELECT with participant checks
-- ---------------------------------------------------------------------------

drop policy if exists wait_timer_events_participant_select on public.wait_timer_events;

create policy wait_timer_events_select_participants
on public.wait_timer_events
for select
to authenticated
using (
  (
    entity_type = 'order'
    and exists (
      select 1
      from public.order_participant_ids(wait_timer_events.entity_id) p
      where p.user_id = auth.uid()
    )
  )
  or (
    entity_type = 'delivery_request'
    and exists (
      select 1
      from public.delivery_request_participant_ids(wait_timer_events.entity_id) p
      where p.user_id = auth.uid()
    )
  )
  or (
    entity_type = 'taxi_ride'
    and exists (
      select 1
      from public.taxi_ride_participant_ids(wait_timer_events.entity_id) p
      where p.user_id = auth.uid()
    )
  )
  or public.is_staff_user(auth.uid())
);

-- Writes only via service role / security definer RPCs (no client INSERT/UPDATE/DELETE).

-- ---------------------------------------------------------------------------
-- order_events — enable RLS if created without policies
-- ---------------------------------------------------------------------------

alter table if exists public.order_events enable row level security;

drop policy if exists order_events_select_participants on public.order_events;

create policy order_events_select_participants
on public.order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.order_participant_ids(order_events.order_id) p
    where p.user_id = auth.uid()
  )
  or public.is_staff_user(auth.uid())
);

commit;
