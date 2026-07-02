# Client Service Fee (Admin)

MMD Delivery supports an optional **client Service Fee** on Food, Delivery (errand), Taxi, and Marketplace.  
**Default: OFF everywhere** — no fee is charged until an admin explicitly enables it.

## Legal / transparency

When enabled, the Service Fee must appear **before payment** in:

- Mobile checkout summary (subtotal, delivery, service fee, tax, total)
- Stripe Checkout (separate line item when the fee is greater than zero)

Do not enable the fee without verifying local consumer disclosure rules (US state fees, EU price transparency, etc.).

## Where to configure

| Vertical | Admin page | Config scope |
|----------|------------|--------------|
| **Food** | [Admin → Pricing](/admin/pricing) | Per region row (`food_us`, `food_africa`, `food_default`, …) |
| **Delivery / errand** | [Admin → Pricing](/admin/pricing) | Per region row (`errand_us`, `errand_africa`, …) |
| **Marketplace** | [Admin → Pricing](/admin/pricing) | Row `marketplace_default` |
| **Taxi** | [Admin → Taxi Pricing](/admin/taxi-pricing) | Per country + vehicle class |

## How to enable (Food example)

1. Sign in as **Super Admin** (pricing write access).
2. Open **Admin → Pricing**.
3. Select the row for your market (e.g. **Food pricing — United States** / `food_us`).
4. In **Client Service Fee / Frais de service client**:
   - **Service fee enabled** → **ON**
   - **Service fee %** → e.g. `10` (10% of subtotal after discounts)
   - **Minimum fixed fee** → e.g. `0.99` (USD minimum when percent yields less)
5. Click **Save changes / Enregistrer**.

New quotes and orders use the updated config immediately. Existing unpaid orders keep their frozen totals until recreated.

## How to disable

Set **Service fee enabled** → **OFF** and save. The server returns `service_fee = 0` and the client total excludes the fee.

## Calculation (server-only)

When **ON**:

```
base = subtotal_after_discount  (or delivery_fee if subtotal is 0)
percent_fee = base × service_fee_pct / 100
service_fee = max(service_fee_fixed_cents, percent_fee)   // fixed is a minimum
total = subtotal_after_discount + tax + delivery_fee + service_fee
```

When **OFF**: `service_fee = 0`, total unchanged.

Clients **cannot** send `service_fee*` fields (API guards + SQL RLS on financial columns).

## Database

Migration: `supabase/migrations/20260721120000_client_service_fee_system.sql`

- `pricing_config`: `service_fee_enabled`, `service_fee_pct`, `service_fee_fixed_cents`
- `taxi_pricing`: same three columns
- Snapshot on payables: `orders`, `delivery_requests`, `taxi_rides`, `seller_orders`

Platform commission RPC `refresh_order_commissions` credits `service_fee` to `platform_amount`.

## Code map

| Layer | Files |
|-------|--------|
| Calculation | `apps/web/src/lib/clientServiceFee.ts` |
| Config load | `apps/web/src/lib/serviceFeeConfigLoader.ts` |
| Food/Delivery pricing | `foodOrderServerPricing.ts`, `deliveryRequestServerPricing.ts` |
| Taxi | `apps/web/src/lib/taxiServiceFee.ts` |
| Marketplace | `apps/web/src/lib/marketplaceCheckout.ts` |
| Stripe lines | `apps/web/src/lib/stripeCheckoutBreakdown.ts` |
| Tests | `apps/web/src/lib/clientServiceFee.test.ts` |

## Ops checklist before enabling in production

- [ ] Apply migration `20260721120000_client_service_fee_system.sql`
- [ ] Set fee % and minimum in Admin for target market
- [ ] Enable **ON** only after legal review
- [ ] Place a test order: verify mobile breakdown + Stripe Checkout lines + `orders.service_fee_cents`
- [ ] Confirm restaurant/driver payouts unchanged (fee stays on platform)
