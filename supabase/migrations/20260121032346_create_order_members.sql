-- Create missing table required by storage policies
create table if not exists public.order_members (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  user_id uuid not null,
  role text null,
  created_at timestamptz not null default now(),
  unique (order_id, user_id)
);

create index if not exists order_members_order_id_idx on public.order_members(order_id);
create index if not exists order_members_user_id_idx on public.order_members(user_id);