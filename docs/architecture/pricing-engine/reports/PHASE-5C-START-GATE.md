# Phase 5C — Surface Coverage — START-GATE

**Date :** 2026-08-03  
**Statut :** `APPROUVÉ` (délégation autonome fondateur 2026-08-03 — enchaînement 5B→5E)  
**Amont :** [`PHASE-5B-COMPLETION.md`](./PHASE-5B-COMPLETION.md) — VALIDÉ (délégation)  
**Objectif :** Brancher quote / checkout / **create** / marketplace sur le même SoT dual-path (`select*`), sans supprimer legacy / flags / Kill / Shadow.

---

## IN SCOPE

- `createFoodOrderServerSide` → `selectFoodChargePath`
- `createDeliveryRequestServerSide` → `selectPackageChargePath` (package) ; ride-type DR → legacy forcé
- `POST /api/taxi/rides/create` → `selectRideChargePath`
- Validators Food/Package → compare vs `selection.customerTotalCents`
- Tests `phase5c.surfaceCoverage.test.ts`

## OUT OF SCOPE

- Suppression legacy / flags / Kill / Shadow / wrappers
- Activation flags prod (→ 5D ops)
- Retrait fail-open (→ 5E après preuves prod)
