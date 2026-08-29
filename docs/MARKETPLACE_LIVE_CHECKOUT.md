# Marketplace live checkout — status

`marketplace_checkout_live_enabled` stays **OFF**. Do not flip it to hide “Coming soon”.

## What works now (code)

- Guest and signed-in catalog browse, product search, merchant pages, cart composition
- Shadow / quote totals (not a live charge)
- Seller onboarding and product CRUD
- Account deletion for sellers

## What is still missing for a live money launch

- Play/Apple-ready live checkout certification (`MARKETPLACE_CHECKOUT_LIVE_ENABLED`)
- Live dispatch notifications that are not Phase-12 stubs
- Seller payouts E2E (`MARKETPLACE_SELLER_PAYOUTS_E2E_READY` must stay false until certification; `executeMarketplacePayouts` remains a stub)
- Automatic mobile-money payouts (not implemented)

Until those are certified, the cart must keep showing that live checkout is not available. Browse must keep working.
