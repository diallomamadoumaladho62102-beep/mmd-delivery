# Phase 5F — SoT Hot Path — START-GATE

**Date :** 2026-08-03  
**Type :** START-GATE  
**Statut :** `APPROUVÉ` (2026-08-03) — autorisation fondateur : PE unique moteur avant lancement public  
**Amont :** [`PHASE-6-PRE-CLEANUP-FINAL-VERIFICATION.md`](./PHASE-6-PRE-CLEANUP-FINAL-VERIFICATION.md) — Hard Gate **NO GO** (dual-path)  
**Cutover charge :** [`PE-CUTOVER-EXECUTION-REPORT.md`](./PE-CUTOVER-EXECUTION-REPORT.md) — **GO**  
**Gouvernance :** START-GATE → Approbation → Implémentation → Completion → Hard Gate  

---

## 1. Objectif

Faire du Pricing Engine la **Source of Truth de bout en bout** sur tous les hot paths (quote / checkout / create / validate / materialize), sans exécuter les entrypoints legacy TS ni le dual-path / fail-open.

## 2. Non-suppressions (obligatoire)

| Élément | Action 5F |
|---|---|
| Code legacy (`compute*`, `calculate*`, modules) | **Conservé** (filet Kill / Phase 6) |
| Feature Flags | **Conservés** |
| Kill Switch | **Conservé** (urgence seulement) |
| Shadow Compare | **Conservé** hors hot path |
| Wrappers / `select*` | **Conservés** hors hot path |

## 3. Critères Hard Gate (fin 5F)

1. Hot path n’appelle plus `computeFoodOrderPricing`, `computeDeliveryRequestPricing`, `computeDeliveryPricing`, `calculateTaxiFinalPriceSnapshot`, `computeMarketplaceCheckoutShadow`
2. Hot path n’appelle plus `select*ChargePath` / fail-open
3. Montants quote/checkout/persist/Stripe issus du snapshot PE
4. Commissions / settlements / reversements basés sur cents PE persistés
5. Legacy / flags / Kill / Shadow encore présents dans le dépôt

## 4. Autorisation

Fondateur — 2026-08-03 : travaux nécessaires pour PE indépendant ; **aucune** suppression legacy jusqu’à Phase 6 après Hard Gate GO + START-GATE cleanup.
