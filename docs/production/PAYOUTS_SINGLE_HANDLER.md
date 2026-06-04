# Payouts — single active handler (production)

## Canonical system (Live)

- **Vercel cron (Sunday 03:00 UTC):** `GET /api/admin/process-payouts`
- **Implementation:** `apps/web/app/api/admin/process-payouts/route.ts` → `POST /api/stripe/transfers/run`
- **Config:** `vercel.json` crons

## Supabase Edge — disable batch/cron payouts in production

Set on Edge Functions secrets (all payout batch functions):

```
MMD_EDGE_PAYOUTS_DISABLED=true
```

Affected functions (return `200` + `disabled: true` without moving money):

- `weekly_restaurant_payout`
- `process_driver_payouts`
- `pay_restaurant_scheduled`

**Not disabled by default** (manual / driver wallet flows):

- `pay_restaurant_now` — manual restaurant transfer from authenticated UI
- `pay-driver-now` — driver wallet cashout

## Verification SQL

```sql
-- No duplicate succeeded transfers for same order+target in last 7 days
select order_id, target, count(*) 
from public.order_payouts 
where status = 'succeeded' 
  and created_at > now() - interval '7 days'
group by 1,2 having count(*) > 1;
```

## Ops checklist

1. Stripe Dashboard → Developers → Webhooks: only Vercel URL (see `STRIPE_WEBHOOK_SINGLE_HANDLER.md`).
2. Supabase → Edge secrets: `MMD_EDGE_PAYOUTS_DISABLED=true` on batch payout functions.
3. Vercel env: `CRON_SECRET`, `STRIPE_TRANSFERS_ADMIN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Confirm no Supabase scheduled cron invokes `weekly_restaurant_payout` or `process_driver_payouts`.
