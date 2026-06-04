-- Allow authenticated users to create their own profiles row at signup.

begin;

alter table public.profiles enable row level security;

drop policy if exists profiles_insert_own on public.profiles;

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

commit;
