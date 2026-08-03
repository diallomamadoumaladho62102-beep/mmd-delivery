# Rapport de démarrage — Phase 1 (Configuration)

**Status:** **PROPOSÉ — en attente de validation humaine**  
**Ne pas démarrer** tant que ce rapport n’est pas explicitement approuvé.

**Réf.:** ADR-001 FINAL · Phase 0 closure

---

## 1. Objectifs de la phase

1. Déplacer progressivement les **valeurs métier hardcodées** vers la configuration (tables / config Admin prévues par l’ADR).
2. Conserver un **comportement fonctionnel strictement identique** (parity cent-près).
3. **Aucune** modification de logique métier, formules, ni chemins de charge.
4. Préparer les caches config (ports déjà définis) sans cutover engine.

## 2. Composants concernés

| Zone | Exemples (inventaire audit) | Action Phase 1 |
|---|---|---|
| Livraison V1 defaults | `deliveryPricing.ts` 2.50/0.90/0.15/3.49, 80/20 | Lire depuis `pricing_config` / future rate_card mapping ; parity |
| Taxe Food legacy | `FOOD_LEGACY_TAX_RATE` 0.0888 | Aligner sur `taxi_country_taxes` si row absente → seed, pas nouveau taux inventé |
| Shared ride 15% | `TAXI_SHARED_RIDE_DISCOUNT_PERCENT` | Param config taxi / rule |
| Wait / no-show | `waitTimerTypes`, 5% no-show | Config rules (mêmes valeurs) |
| Marketplace 8%/2.99$ | `marketplaceCheckout` | Config params (mêmes valeurs) |
| V2 coeffs 0.72/0.12 | deliveryPricingEngine | Config shadow only (pas charge) |
| Seuils tip/cashout/credit | 50¢, 20$, etc. | thresholds config |
| UI faux calculs | DriverPayout −5%, earnings page | **Ne pas “migrer”** — documenter pour Phase 6 cleanup ; Phase 1 = no behavior change so leave or mark deprecated without UX change |

**Hors Phase 1 :** migrations Quote Snapshot tables, wiring Shadow sur routes live, cutover Food/Ride.

## 3. Risques identifiés

| Risque | Impact | Mitigation |
|---|---|---|
| Drift de prix lors du déplacement d’une constante | Élevé | Tests de parité golden (mêmes inputs → mêmes cents) |
| Seed Admin manquant → fallback silencieux différent | Élevé | Fail-closed ou fallback **byte-identical** aux hardcodes actuels |
| Double source (`food_us` vs `food_default`) | Moyen | Corriger résolution de clé **sans** changer taux effectifs US |
| Scope creep (changer une formule) | Élevé | Gate revue : “config move only” checklist |

## 4. Impacts éventuels

- **Utilisateurs / prix / paiements :** aucun si parity respectée.
- **Admin :** peut voir de nouveaux champs / seeds (même valeurs).
- **Code :** suppression progressive des littéraux métier au profit de loaders config.
- **DB :** éventuelles seeds / colonnes de config — **pas** de changement d’algorithme de quote.

## 5. Tests prévus

1. Golden parity suites : Food quote, Package quote, Taxi quote, Marketplace shadow totals — before/after byte-identical cents.
2. Tests loaders config (missing row → documented fallback identical to former hardcoded).
3. Régression : checkout amounts inchangés sur fixtures existantes.
4. Vérifier qu’aucun `resolveChargePath` ≠ legacy.

## 6. Critères de validation

- [ ] 100 % des hardcodes métier listés dans l’audit Phase 1 checklist externalisés **ou** explicitement reportés au backlog avec justification
- [ ] Parity tests verts (diff = 0¢ sur jeux de fixtures)
- [ ] Aucune route charge n’utilise le Pricing Engine
- [ ] Kill Switch / flags inchangés (defaults safe)
- [ ] Documentation mise à jour (mapping hardcode → config key)
- [ ] Validation humaine de fin de Phase 1

## 7. Plan de rollback

1. Revert PR(s) Phase 1 (git) — hardcodes / loaders précédents.
2. Aucun flag engine à désactiver (engine non chargeant).
3. Si seed DB : rollback migration seed ou restore valeurs précédentes (même chiffres).

## 8. Demande

**Merci de répondre explicitement :**  
`Phase 1 — APPROUVÉ` ou `Phase 1 — REPORTÉ` (avec motifs).

Aucun travail de Phase 1 ne commencera sans cette validation.
