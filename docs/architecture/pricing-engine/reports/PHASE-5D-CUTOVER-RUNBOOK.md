# Phase 5D — Runbook cutover Production (Pricing Engine)

**Statut :** Prêt ops — **non exécuté en production** par cette délégation  
**Rollback immédiat :** `PRICING_ENGINE_KILL_SWITCH=true` ou `PRICING_ENGINE_CANARY_PCT=0` ou `SERVICE_*=false`

---

## Pré-requis

1. Phase 5B Independence VALIDÉE  
2. Phase 5C Surface Coverage VALIDÉE  
3. Suites `phase5b` / `phase5c` / `phase5d` / cutover 3–5 **OK**  
4. Shadow activable : `PRICING_ENGINE_SHADOW=true`  
5. Accès env staging puis prod (Vercel / secrets)

### Inspecteur (staging/prod runtime)

```ts
import { inspectPricingEngineCutoverReadiness } from "@/lib/pricingEngine";
console.log(inspectPricingEngineCutoverReadiness(process.env));
```

`blockers.length === 0` et `services.*.desiredPathWithCanaryKey === "engine"` uniquement quand SERVICE + canary 100 + kill off.

---

## Ladder recommandée

| Étape | Environnement | Flags | Observation |
|---|---|---|---|
| D1 | Staging | SERVICE_*=true, CANARY=5, SHADOW=true, KILL=false | 24–48 h ; fail-open ≈ 0 |
| D2 | Staging | CANARY=25 | 24 h |
| D3 | Staging | CANARY=50 | 24 h |
| D4 | Staging | CANARY=100 | ≥ 48 h ; smokes Food/Package/Taxi/Marketplace |
| D5 | Prod | CANARY=5 | 48–72 h ; Live payments OK |
| D6 | Prod | 25 → 50 → 100 | paliers ; métriques `cutoverMetrics` / snapshots |
| D7 | Prod | CANARY=100 durable | **fenêtre ≥ 7 jours** avant Hard Gate GO |

À chaque palier, vérifier :

- `charge_path=engine` sur le % attendu  
- fail-open ≈ 0  
- 0 incident prix / Stripe mismatch  
- Kill Switch drill documenté (staging)

---

## Rollback

| Symptôme | Action |
|---|---|
| Divergence prix / PI | `PRICING_ENGINE_KILL_SWITCH=true` |
| Canary trop agressif | `CANARY_PCT=0` |
| Un service KO | `SERVICE_<X>=false` |

**Ne pas** supprimer le code legacy pendant le cutover.
