# Final polish — ops gates (do not flip blindly)

Status as of the final product-polish pass. Code may be ready while **founders / providers** still must approve live money or messaging.

## Already production-ready in code + running

| Item | Evidence |
|------|----------|
| High-frequency dispatch | GitHub Actions `Production dispatch crons` every 3 min — recent runs **success**. Set `EXTERNAL_DISPATCH_CRON_CONFIGURED=true` in Vercel when documenting cert status (ops sign-off; code already live). |
| Daily money / ops | Vercel Hobby crons (`daily-money`, `daily-ops`) |
| Food / Taxi / Package Stripe pay-then-create | Live on `main` |
| Stripe Connect hybrid payouts (food/taxi) | Code path live-capable; Edge batch disabled by default |

## Must stay OFF until separate certification

### Marketplace Live

Do **not** set these until seller payout E2E is signed off:

- `MARKETPLACE_SELLER_PAYOUTS_E2E_READY`
- `MARKETPLACE_CHECKOUT_LIVE_ENABLED`
- `MARKETPLACE_DISPATCH_LIVE_ENABLED`
- `MARKETPLACE_PAYOUTS_LIVE_ENABLED`

Plus matching Admin platform-launch DB flags.

**Why:** Marketplace Live moves real seller money and starts live dispatch. Food/Taxi launch does not require it. Draft carts remain non-operational until paid.

### SMS A2P 10DLC (US)

- Code: `TRANSACTIONAL_SMS_ENABLED` + Twilio
- External: LLC/EIN + Twilio A2P brand/campaign approval
- Gate flag: `SMS_A2P_10DLC_US_DONE` (ops sign-off only)

Do not enable scale US SMS until Twilio confirms A2P.

### Transactional email

- Code ready when `TRANSACTIONAL_EMAIL_ENABLED=true`
- Prerequisites: Resend API key + verified domain/`ADMIN_EMAIL_FROM`
- Validate: `apps/web/scripts/validate-transactional-email.mjs` (optional `--send`)
- Only then flip the Vercel Production env flag

### Live payment / Connect sign-off

- Device + real card smoke → set `LIVE_PAYMENT_E2E_SIGNOFF_DONE`
- Africa / multi-country Connect capabilities → Stripe Dashboard + KYC smoke

## Client wallet product rules (intentional)

| Capability | Client | Driver | Business |
|------------|--------|--------|----------|
| Spendable balance | MMD credit | Connect available | Business wallet |
| Payment activity ledger | Yes (charges/refunds) | Yes | Yes |
| Cashout / Connect | **No** | Yes | N/A |
| Card top-up | **No** (use card at checkout) | N/A | Yes |

Personal client “reload” is intentionally omitted: clients pay per trip/order; prepaid balances are Business-account only.

## After code deploy of polish

1. Apply notification + business invite migrations to linked prod.
2. Smoke new APIs on Preview/Production.
3. Founder decides email enablement after Resend DNS check.
4. Keep Marketplace Live and A2P off until external gates clear.
