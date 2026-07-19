# Finance runbook

## Pipeline

1. Business event succeeds (payment/refund/etc.).
2. `finance_source_events` enqueued (fail-open).
3. Cron `/api/cron/process-finance` posts journal entries.
4. Balances refresh; exports expire after readiness window.
5. Revenue recognition cron `/api/cron/recognize-finance-revenue` amortizes schedules.

## Manual ops

- **Retry pending:** Admin Finance → Traiter événements.
- **manual_review / failed:** inspect payload_snapshot; fix data; re-process idempotently.
- **Integrity:** query `v_finance_ledger_integrity` (service_role) for unbalanced posted entries.
- **Adjustments:** create → pending_approval → second approver (no self-approve).
- **Period close:** checklist (pending events, reconciliations, disputes) then close.
- **Reconciliations / settlements:** runs table; resolve with audit.

## Rules

- No direct balance edits.
- Corrections = compensating entries.
- Closed period → post into new period referencing original.
- Support has lookup only — not ledger.
