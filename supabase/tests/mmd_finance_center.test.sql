-- Phase 9 finance smoke checklist (manual / CI)
-- Expected tables: finance_accounts, finance_journal_entries, finance_source_events, ...
-- Expected RPCs: mmd_finance_enqueue_event, mmd_finance_post_entry,
--   mmd_finance_process_source_event, mmd_finance_process_pending_batch,
--   mmd_finance_reverse_entry, mmd_finance_refresh_balances
select 1;
