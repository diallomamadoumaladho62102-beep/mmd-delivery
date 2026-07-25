-- Control Center enterprise: internal admin tasks (Founder / staff work queue)
-- Idempotent: create-if-not-exists, drop/recreate policies by name.
-- No destructive changes to existing product tables.

begin;

create table if not exists public.admin_control_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled')),
  due_at timestamptz,
  country_code text,
  region text,
  privacy text not null default 'internal'
    check (privacy in ('internal', 'restricted', 'confidential')),
  checklist jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_control_task_assignees (
  task_id uuid not null references public.admin_control_tasks (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, admin_id)
);

create index if not exists admin_control_tasks_status_idx
  on public.admin_control_tasks (status, due_at);

create index if not exists admin_control_tasks_created_by_idx
  on public.admin_control_tasks (created_by);

create index if not exists admin_control_task_assignees_admin_idx
  on public.admin_control_task_assignees (admin_id);

-- Helper: durable founder check (SECURITY DEFINER, fixed search_path).
create or replace function public.is_founder_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and coalesce(p.is_founder, false) = true
  );
$$;

-- Can the viewer see this task row?
create or replace function public.can_access_admin_control_task(
  p_task_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_founder_user(p_user_id)
    or public.is_super_admin_user(p_user_id)
    or (
      public.is_staff_user(p_user_id)
      and exists (
        select 1
        from public.admin_control_tasks t
        where t.id = p_task_id
          and (
            t.privacy <> 'confidential'
            or public.is_founder_user(p_user_id)
            or public.is_super_admin_user(p_user_id)
          )
          and (
            t.created_by = p_user_id
            or exists (
              select 1
              from public.admin_control_task_assignees a
              where a.task_id = t.id
                and a.admin_id = p_user_id
            )
          )
      )
    );
$$;

revoke all on function public.is_founder_user(uuid) from public;
revoke all on function public.can_access_admin_control_task(uuid, uuid) from public;
grant execute on function public.is_founder_user(uuid) to authenticated;
grant execute on function public.can_access_admin_control_task(uuid, uuid) to authenticated;

alter table public.admin_control_tasks enable row level security;
alter table public.admin_control_task_assignees enable row level security;

-- Lock down direct table grants: no anon access; authenticated via RLS only.
revoke all on table public.admin_control_tasks from anon, public;
revoke all on table public.admin_control_task_assignees from anon, public;
grant select, insert, update, delete on table public.admin_control_tasks to authenticated;
grant select, insert, update, delete on table public.admin_control_task_assignees to authenticated;
-- service_role retains full access (Supabase default) for Admin API routes.

drop policy if exists admin_control_tasks_select on public.admin_control_tasks;
drop policy if exists admin_control_tasks_insert on public.admin_control_tasks;
drop policy if exists admin_control_tasks_update on public.admin_control_tasks;
drop policy if exists admin_control_tasks_delete on public.admin_control_tasks;
drop policy if exists admin_control_task_assignees_select on public.admin_control_task_assignees;
drop policy if exists admin_control_task_assignees_insert on public.admin_control_task_assignees;
drop policy if exists admin_control_task_assignees_update on public.admin_control_task_assignees;
drop policy if exists admin_control_task_assignees_delete on public.admin_control_task_assignees;

-- SELECT: founder / super admin see all; other staff see owned/assigned non-confidential.
create policy admin_control_tasks_select
on public.admin_control_tasks
for select
to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and privacy <> 'confidential'
    and (
      created_by = auth.uid()
      or exists (
        select 1
        from public.admin_control_task_assignees a
        where a.task_id = admin_control_tasks.id
          and a.admin_id = auth.uid()
      )
    )
  )
);

-- INSERT: staff only; created_by must be self (Founder/super admin may set any created_by).
create policy admin_control_tasks_insert
on public.admin_control_tasks
for insert
to authenticated
with check (
  public.is_staff_user(auth.uid())
  and (
    created_by = auth.uid()
    or public.is_founder_user(auth.uid())
    or public.is_super_admin_user(auth.uid())
  )
  and (
    privacy <> 'confidential'
    or public.is_founder_user(auth.uid())
    or public.is_super_admin_user(auth.uid())
  )
);

-- UPDATE: founder/super admin any; others only owned/assigned non-confidential.
create policy admin_control_tasks_update
on public.admin_control_tasks
for update
to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and privacy <> 'confidential'
    and (
      created_by = auth.uid()
      or exists (
        select 1
        from public.admin_control_task_assignees a
        where a.task_id = admin_control_tasks.id
          and a.admin_id = auth.uid()
      )
    )
  )
)
with check (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and privacy <> 'confidential'
  )
);

-- DELETE: founder / super admin, or original creator (non-confidential).
create policy admin_control_tasks_delete
on public.admin_control_tasks
for delete
to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and created_by = auth.uid()
    and privacy <> 'confidential'
  )
);

-- Assignees: visible if parent task accessible; mutate if founder/super admin or task creator.
create policy admin_control_task_assignees_select
on public.admin_control_task_assignees
for select
to authenticated
using (public.can_access_admin_control_task(task_id, auth.uid()));

create policy admin_control_task_assignees_insert
on public.admin_control_task_assignees
for insert
to authenticated
with check (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and exists (
      select 1
      from public.admin_control_tasks t
      where t.id = task_id
        and t.created_by = auth.uid()
        and t.privacy <> 'confidential'
    )
  )
);

create policy admin_control_task_assignees_update
on public.admin_control_task_assignees
for update
to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
)
with check (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
);

create policy admin_control_task_assignees_delete
on public.admin_control_task_assignees
for delete
to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or (
    public.is_staff_user(auth.uid())
    and exists (
      select 1
      from public.admin_control_tasks t
      where t.id = task_id
        and t.created_by = auth.uid()
    )
  )
);

commit;
