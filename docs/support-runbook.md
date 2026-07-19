# Support runbook

## Access limits

Support **cannot** open the global Finance dashboard, P&L, or exports.  
Use **transaction lookup** (`finance.transactions.lookup`) with a specific order / ride / delivery / seller_order id.

Returned fields: payment status, refund status, amount, date, masked payment reference, client id.

## Common cases

| Case | Guidance |
|------|----------|
| Debited without order | Lookup PI / entity; if paid without entity → escalate Finance (suspense) |
| Not delivered | Check order status + driver assignment; refund only via authorized flow |
| Driver no-show | Cancel policy; waiting fees if applicable |
| Restaurant closed | Cancel / refund path; notify client |
| Refund pending | Check Stripe refund + `refund_status`; wait for webhook |
| Missing MMD credit | Loyalty/credit history; escalate if ledger mismatch |
| Missing points | Confirm paid completed; idempotent accrue; no manual points without loyalty.manage |
| Coupon refused | Eligibility (min cart, country, stacking); Marketing support |
| Cashback pending | Availability date; clawback rules |
| Subscription billed | MMD+ / partner portal invoices |
| Double payment | Escalate Finance immediately (P0) |
| Waiting fee dispute | Show wait timer snapshot; Ops/Finance if adjustment needed |

Never promise Live refunds/payouts from Support chat without Finance approval.
