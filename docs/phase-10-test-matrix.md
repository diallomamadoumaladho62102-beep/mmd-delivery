# Phase 10 / 10.1 — Test matrix

Statuses: `not_started` | `passed` | `failed` | `blocked` | `not_applicable`  
**Rule:** never mark `passed` without a real execution.

**Updated:** 2026-07-19 (Phase 10.1 Docker/local Supabase unblocked) — WSL Ubuntu `/mnt/c/DEV/MMD-Delivery`, branch `feat/unified-loyalty`.

| domaine | scénario | environnement | statut | preuve / notes |
|---------|----------|---------------|--------|----------------|
| inventory | versions WSL node/pnpm/eas | WSL | passed | node v20.20.2, pnpm 10.33.0, supabase CLI 2.109.1 |
| install | pnpm install after node_modules wipe | WSL | passed | `INSTALL_EXIT:0` (undici pinned 6.23.0) |
| web | tsc --noEmit | WSL | passed | ~55 → 0 errors |
| web | pnpm lint | WSL | passed | `LINT:0` — 0 errors, 53 warnings |
| web | unit strip/liveGuard/RBAC/loyalty | WSL | passed | exit 0 |
| web | pnpm build | WSL | passed | `BUILD_EXIT:0` |
| stripe | Test PI create+cancel | WSL | passed | `livemode=false` `STRIPE_PROBE:0` |
| stripe | Stripe CLI / webhook E2E | WSL | blocked | Stripe CLI absent |
| migrations | empty DB `supabase db reset` | local 127.0.0.1:54322 | passed | `RESET_EXIT:0` — 136 migrations incl. `20260906130000` |
| sql | mmd_loyalty_finalization.test.sql | local | passed | EXIT:0 |
| sql | mmd_marketing_finalization.test.sql | local | passed | EXIT:0 (`select 1` smoke) |
| sql | mmd_finance_center.test.sql | local | passed | EXIT:0 (`select 1` smoke) |
| sql | mmd_phase_10_stabilization.test.sql | local | passed | EXIT:0 |
| rpc | marketing reserve/reverse | local | passed | reserve ok (no discount), reverse `no_capture` |
| rpc | finance enqueue/process/refresh/revenue | local service_role JWT | passed | enqueue pending→posted 1; refresh accounts 2 |
| rpc | analytics refresh daily | local service_role JWT | passed | ok metrics payload |
| rpc | driver eligibility helper | local | passed | returns structured deny without payout method |
| migrations | incremental Preview remote | preview | blocked | no Preview Supabase project wired; Production forbidden |
| mobile | expo-doctor / tsc / expo export | WSL | passed | 18/18 ; MOBILE_TSC:0 ; EXPORT_EXIT:0 |
| android | EAS Preview build | EAS | passed | `54b9b30a-…` / `272e291d-…` `EAS_EXIT:0` |
| ios | EAS Preview build | EAS | blocked | not launched (Apple human) |
| mobile | device smoke | device | blocked | no emulator/device this session |
| preview web | Vercel Preview deploy | Vercel | blocked | not launched this pass |
| production | deploy / migrate / live pay | production | not_applicable | forbidden |
