-- Harden Identity notification + events idempotency for production webhooks.

begin;

-- Keep the earliest row per dedup_key, drop later duplicates (if any).
delete from public.notification_logs nl
using public.notification_logs newer
where nl.dedup_key is not null
  and newer.dedup_key is not null
  and nl.dedup_key = newer.dedup_key
  and nl.id <> newer.id
  and (
    nl.created_at > newer.created_at
    or (nl.created_at = newer.created_at and nl.id::text > newer.id::text)
  );

create unique index if not exists notification_logs_dedup_key_uidx
  on public.notification_logs (dedup_key)
  where dedup_key is not null;

notify pgrst, 'reload schema';

commit;
