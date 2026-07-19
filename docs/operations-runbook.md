# Operations runbook

## Approvals

- **Driver:** Admin → Drivers → review docs / identity → set status approved; confirm vehicle eligibility.
- **Restaurant / Seller:** Admin users → review → approve; verify payout onboarding before live payouts.

## Monitoring

- Orders / rides: Admin orders & taxi modules; dispatch dashboards.
- Failed payment: payments module + Stripe Test dashboard; check `payment_transactions` status.
- Crons: Vercel cron logs; job locks in `cron_job_locks`.
- Finance alerts: `/admin/finance` failed / manual_review events.
- Marketing: `/admin/marketing` ops actions.

## Incident actions

| Issue | Steps |
|-------|--------|
| Payment failed | Confirm PI status; do not mark paid manually without PI succeeded |
| Refund | Prefer Stripe Test refund → webhook; verify marketing reverse + finance enqueue |
| Stuck finance event | Finance → Traiter événements; inspect `last_error` |
| Disable feature | Platform launch / feature flags + env kill switches |
| Escalate Finance | Tag finance role; do not adjust balances from Ops |
| Escalate Tech | Sentry issue + correlation_id / payment_intent / order_id |

## Kill switches

Prefer env/feature flags: marketplace live checkout, payouts, marketing campaigns, finance processing (cron auth).
