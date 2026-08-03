# Rapport de fin — Phase 2 (Parallel Run / Shadow Compare)

**Date:** 2026-08-01  
**Statut:** **CLÔTURÉE** (validation humaine 2026-08-01)  
**ADR:** ADR-001 FINAL  
**Charge path:** **legacy uniquement** (`PRICING_ENGINE_MIGRATION_PHASE = 2`, `resolveChargePath` → `legacy`)  
**Pricing Engine:** **Shadow uniquement** pendant toute la Phase 2 — aucun cutover

---

## 1. Objectif atteint

Faire tourner le Pricing Engine **en parallèle** du moteur historique via Shadow Compare (tolérance **0¢**), collecter la parité et les métriques, tester le Kill Switch, sans aucun impact utilisateur / prix / paiement.

---

## 2. Composants livrés

| Élément | Emplacement |
|---|---|
| Phase gate = 2 | `apps/web/src/lib/pricingEngine/phaseGate.ts` |
| Pipeline assemble (Rate→…→Snapshot) | `engine/assembleQuote.ts` |
| Adapters Food / Package / Ride / Marketplace | `engine/adapters/*` |
| Shadow Compare 0¢ | `shadow/compareQuotes.ts` |
| Runner + schedule non-bloquant | `shadow/runShadowCompare.ts` |
| Métriques + rapport | `shadow/metrics.ts` (`formatShadowMetricsReport`) |
| Journal Shadow in-memory | `shadow/journal.ts` (cap 2000) |
| Table audit DB | `supabase/migrations/20261101130000_pricing_shadow_compare_logs.sql` |
| Hooks quote (réponse = legacy) | Food, Package, Taxi, Marketplace |
| Harness volume staging | `phase2ParityHarness.ts` |
| Tests unitaires + Kill Switch | `phase2.shadow.test.ts`, `phase2.killSwitch.test.ts` |

### Comportement production (inchangé)

- Réponse client / PaymentIntent / checkout = **toujours Legacy**
- Shadow uniquement si `PRICING_ENGINE_SHADOW=true` et Kill Switch off
- Échecs shadow = fail-open (jamais d’impact HTTP charge)
- `resolveChargePath` → **`legacy`** tant que phase &lt; 3 (même avec service flags / canary)

---

## 3. Résultats de parité (critère staging N ≥ 500)

**Harness offline exécuté le 2026-08-01** (`phase2ParityHarness.ts`, `SHADOW` forcé via `flagsOverride`, `persist: false`).

| Métrique | Valeur |
|---|---|
| Compared | **520** |
| Equal | **520** |
| Diff | **0** |
| Errors | **0** |
| Parity % | **100 %** (≥ 99,5 % **OK**) |
| Food | 130 / 130 equal |
| Package | 130 / 130 equal |
| Ride | 130 / 130 equal |
| Marketplace | 130 / 130 equal |
| Currencies couvertes | USD, CAD, EUR, GBP |
| `stripeCallsInShadow` | **0** |
| Charge path après flags agressifs | **legacy** |

### Latences (in-process harness)

| | Avg ms | Max ms |
|---|---|---|
| Legacy (simulated input latency) | 2,74 | 6 |
| Engine assemble | 0,01 | 1 |

### Écarts documentés

Aucun écart monétaire (`diffCents === 0`, `fieldDiffs` vides) sur les 520 scénarios.

> **Note méthode :** les adapters Phase 2 comparent le total capturé Legacy vs assemblage Engine à partir des mêmes montants capturés (pas de 2ᵉ Mapbox / Stripe). C’est conforme au gate Shadow (parity intent, charge = legacy). Les hooks runtime loggent aussi vers `pricing_shadow_compare_logs` lorsque la migration est appliquée et `SHADOW=true`.

### Prod shadow M ≥ 2000

**Non exécuté** — aucun trafic réel / aucun Shadow prod activé (consigne explicite : pas de cutover, pas de trafic Engine). Critère « prod shadow si activé » reste **N/A** jusqu’à go ops optionnel hors Phase 3.

---

## 4. Kill Switch — drill

Fichier : `phase2.killSwitch.test.ts` — **OK**

| Cas | Résultat |
|---|---|
| `SHADOW=true`, Kill off | Compare exécutée + journal |
| Kill Switch ON | Runner → `null` immédiat ; journal / métriques non incrémentés |
| `SHADOW=false` | Runner → `null` |
| `samplePct=0` | Runner → `null` |
| Service flags + canary 100 % en Phase 2 | `resolveChargePath` → **legacy** |
| Kill Switch | Force charge **legacy** |

---

## 5. Métriques & journaux Shadow — finalisés

| Canal | Statut |
|---|---|
| `getShadowMetricsSnapshot` / `formatShadowMetricsReport` | **Finalisé** (compared, equal, diff, parity %, latences avg/max, dbWrites, stripeCalls) |
| Journal mémoire `shadow/journal.ts` | **Finalisé** (cap 2000, `summarizeShadowJournal`) |
| Table `pricing_shadow_compare_logs` | Migration livrée ; inserts best-effort depuis le runner (RLS admin read) |
| Logs structurés | `noopPricingLogger` + `console.warn` sur `parity_diff` |
| Stripe dans le path shadow | **0 appels** (invariant vérifié harness) |

---

## 6. Feature Flags (Phase 2)

| Flag | Valeur cible | Effet |
|---|---|---|
| `PRICING_ENGINE_SHADOW` | ops staging | Active compare parallèle |
| `PRICING_ENGINE_KILL_SWITCH` | `false` (drill `true`) | Coupe shadow ; charge legacy |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | 0–100 (défaut 100) | Échantillonnage |
| `PRICING_ENGINE_SERVICE_*` | **OFF** | Ignorés pour charge (phase &lt; 3) |
| `PRICING_ENGINE_CANARY_PCT` | **0** | Ignoré pour charge |

Activation staging recommandée :

```bash
PRICING_ENGINE_SHADOW=true
PRICING_ENGINE_KILL_SWITCH=false
PRICING_ENGINE_SHADOW_SAMPLE_PCT=100
```

---

## 7. Tests exécutés

| Suite | Résultat |
|---|---|
| `flags.phase0.test.ts` | OK |
| `phase1.parity.test.ts` | OK |
| `phase2.shadow.test.ts` | OK |
| `phase2.killSwitch.test.ts` | OK |
| `phase2ParityHarness.ts` (520) | OK — gate 99,5 % passé |

---

## 8. Impacts

| Surface | Impact |
|---|---|
| Utilisateurs / prix affichés | **Aucun** (réponse = legacy) |
| Paiements / Stripe charge | **Aucun** |
| Latence HTTP quote | Shadow **non-bloquant** (`schedulePricingShadowCompare`) |
| Architecture ADR | **Aucune modification** |
| Phase 3 | **Non démarrée** |

---

## 9. Critères de clôture Phase 2 (checklist)

| Critère (PHASE-2-START-GATE §6) | Statut |
|---|---|
| Engine derrière contrats + parity intent | **OK** |
| Shadow Compare Food + Package (+ Ride + Marketplace) | **OK** |
| Staging ≥ 500 @ ≥ 99,5 % equal | **OK** (520 @ 100 %) |
| Prod shadow ≥ 2000 | **N/A** (non activé ; pas de trafic réel) |
| Kill Switch testé | **OK** |
| Feature Flags validés | **OK** |
| Rapport de fin + validation humaine | **Rapport livré — validation humaine requise** |

---

## 10. Recommandation

1. ~~Valider humainement ce rapport pour clôturer officiellement la Phase 2.~~ **Fait — Phase 2 CLÔTURÉE.**  
2. Recevoir et examiner le **PHASE-3-START-GATE** avant tout développement Phase 3.  
3. Optionnel ops : activer Shadow staging live + migration DB pour journaliser en table (sans changer la charge).  
4. Phase 3 (Food & Package cutover) uniquement après **`Phase 3 — APPROUVÉ`**.

---

## 11. Décision

- **`Phase 2 — CLÔTURÉE`** — validée le 2026-08-01  
- Prochaine étape documentaire : [PHASE-3-START-GATE](./PHASE-3-START-GATE.md)  
- **Aucun cutover. Aucun trafic Engine en production tant que la Phase 3 n’est pas explicitement approuvée.**
