# RBAC matrix — MMD Delivery Admin

Server enforcement: `assertStaffPermission` + `adminRbac.ts`. UI hiding is not sufficient.

## Roles

| Role | Scope |
|------|--------|
| admin | Full staff permissions |
| finance | Payments, payouts, finance center, analytics finance, marketing finance |
| ops | Operations + limited finance read (no close/adjust) |
| support | Tickets, orders, chats — **transaction lookup only** for finance |
| review | Identity/seller review + finance audit/export read |

## Finance permissions

| Permission | admin | finance | ops | support | review |
|------------|-------|---------|-----|---------|--------|
| finance.read (P&L / dashboard) | ✓ | ✓ | ✓ | ✗ | ✓ |
| finance.transactions.read | ✓ | ✓ | ✓ | ✗ | ✗ |
| finance.transactions.lookup | ✓ | ✓ | ✗ | ✓ | ✗ |
| finance.export | ✓ | ✓ | ✗ | ✗ | ✓ |
| finance.adjustments.* | ✓ | ✓ | ✗ | ✗ | ✗ |
| finance.periods.manage | ✓ | ✓ | ✗ | ✗ | ✗ |
| finance.audit.read | ✓ | ✓ | ✗ | ✗ | ✓ |

## Support limits

Support **may**: look up a single payment/refund by entity id via `/api/admin/finance/transaction-lookup` (masked PI).

Support **must not**: open `/admin/finance` global dashboard, export journals, view ledger, P&L, bank/settlement aggregates, or other clients’ data without a specific entity context.

## Dual approval

High-value finance adjustments require dual approval; requester cannot self-approve.
