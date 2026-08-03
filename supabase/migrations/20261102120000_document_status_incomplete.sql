-- Align driver_documents.status with the app and stop 22P02 empty-string failures.
-- Prod drifted to enum public.document_status (pending|approved|rejected) while
-- the original migration used TEXT + CHECK including 'incomplete'. Empty string
-- cannot be cast to that enum (Sentry MMD-DELIVERY-WEB-5). Restore TEXT + CHECK
-- and normalize blank values before write.

do $$
begin
  -- If still an enum-typed column, convert to text first.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_documents'
      and column_name = 'status'
      and udt_name = 'document_status'
  ) then
    alter table public.driver_documents
      alter column status type text
      using status::text;
  end if;
end $$;

alter table public.driver_documents
  alter column status set default 'pending';

alter table public.driver_documents
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_documents_status_check'
      and conrelid = 'public.driver_documents'::regclass
  ) then
    alter table public.driver_documents
      add constraint driver_documents_status_check
      check (status in ('pending', 'approved', 'rejected', 'incomplete'));
  end if;
end $$;

create or replace function public.normalize_driver_document_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null or btrim(new.status::text) = '' then
    new.status := 'pending';
  else
    new.status := lower(btrim(new.status::text));
  end if;

  if new.status not in ('pending', 'approved', 'rejected', 'incomplete') then
    raise exception 'invalid driver_documents.status: %', new.status
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_driver_document_status on public.driver_documents;
create trigger trg_normalize_driver_document_status
  before insert or update on public.driver_documents
  for each row
  execute function public.normalize_driver_document_status();
