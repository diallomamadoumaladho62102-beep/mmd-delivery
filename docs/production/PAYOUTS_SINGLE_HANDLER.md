# Payouts — single active handler (production)

## Canonical system (Live)

- **Immediate (primary):** `POST /api/orders/delivered-confirm` triggers `transfers/run` for driver + restaurant right after delivery.
- **Safety-net cron:** `GET /api/admin/process-payouts` (Vercel cron) catches unpaid delivered orders.
- **Implementation:** `apps/web/app/api/admin/process-payouts/route.ts` → `POST /api/stripe/transfers/run`
- **Config:** `vercel.json` crons

### Payout mode (`MMD_PAYOUT_MODE` on Vercel)

| Mode | Behavior |
|------|----------|
| `hybrid` (default) | **Primary:** `delivered-confirm` → `transfers/run` at delivery. **Safety-net:** Vercel cron `process-payouts` daily for delivered orders in the last 14 days still missing payout flags. |
| `weekly` | Cron only on Sunday UTC; previous-week window on `created_at`. `delivered-confirm` still triggers immediate transfer when configured. |
| `immediate` | **No batch cron payouts** (`process-payouts` returns `skipped` for cron). All restaurant/driver transfers must go through `delivered-confirm` → `transfers/run`. |

Commissions are computed by `refresh_order_commissions` (migration `20260604120000_*`) before any transfer. Payout amounts come **only** from `order_commissions` (no subtotal/delivery_fee fallbacks).

## Supabase Edge — disable batch/cron payouts in production

Set on Edge Functions secrets (all payout batch functions):

```
MMD_EDGE_PAYOUTS_DISABLED=true
```

Affected functions (return `200` + `disabled: true` without moving money):

- `weekly_restaurant_payout`
- `process_driver_payouts`
- `pay_restaurant_scheduled`

**Also disabled when `MMD_EDGE_PAYOUTS_DISABLED=true`:**

- `pay_restaurant_now` — manual restaurant transfer (use Vercel `transfers/run` / admin)
- `pay-driver-now` — driver wallet cashout (use Vercel canonical payouts)

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
