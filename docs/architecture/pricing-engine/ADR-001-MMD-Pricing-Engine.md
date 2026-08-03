# ADR-001 — MMD Pricing Engine (FINAL)

| Field | Value |
|---|---|
| **Status** | **Accepted / Frozen** |
| **Revision** | Final (Rev 2 + complements) |
| **Date accepted** | 2026-08-01 |
| **Supersedes** | ADR-001 Rev 1, Rev 2 |
| **Implementation** | Phase 0 Freeze started; no production algorithm change |

This document is the **reference architecture** for the future MMD Pricing Engine.
After this freeze:

- **No new engines** may be added.
- **No responsibilities** may be moved between engines.
- **Only implementations** evolve (behind feature flags).

---

## 1. Decision

Replace fragmented pricing paths with one modular, configurable, versioned **MMD Pricing Engine** shared by Ride, Food, Package Delivery, and Marketplace, with an immutable **Quote Snapshot** as post-quote Source of Truth, and progressive migration via **Feature Flags**, **Shadow Compare**, and **Kill Switch**.

**Zero business hardcodes** in application logic. All tariff parameters live in Rate Cards, Pricing Rules, Tax catalog, Policy Rules, and related config — editable without redeploy.

---

## 2. Canonical pipeline

```text
Pricing Engine (Facade)
  → Rate Engine
  → Tax Engine
  → Fee Engine
  → Promotion Engine
  → Policy Engine
  → Commission Engine
  → Validation Engine
  → Quote Snapshot (Source of Truth)
  → Settlement Engine
       → Stripe Connect
       → Wallet
       → Ledger
```

**Orthogonal engines (not on the charge-critical path except as readers/writers of config):**

| Engine | Role |
|---|---|
| Explain Engine | Human-readable price breakdown |
| Audit Engine | Config change history |
| Pricing Simulator | What-if using the same engines as production |

---

## 3. Contract-driven architecture (mandatory)

1. Engines communicate **only** through the official interfaces defined in this ADR and in `apps/web/src/lib/pricingEngine/contracts/`.
2. **No engine** may read another engine’s internal structures.
3. Interfaces are the **system contract**. Changing a contract requires an ADR amendment (not allowed during freeze without a new ADR revision).
4. Implementations may be swapped if they honor the same contract (Liskov / ports & adapters).

---

## 4. Backward compatibility (mandatory during migration)

| Rule | Requirement |
|---|---|
| Legacy remains functional | Until per-service cutover is validated |
| Existing orders unchanged | No behavioral change for in-flight or historical orders |
| Old snapshots remain valid | Versioned; never recomputed |
| Immediate rollback | Kill switch forces legacy charge path |

---

## 5. Engines — single responsibility

| Engine | Does | Never does |
|---|---|---|
| Rate | Base price from Rate Card | Tax, fees, promo, split, pay |
| Tax | Regulatory taxes | Platform fees, discounts |
| Fee | Independent fee lines | Base fare, promotions |
| Promotion | Discounts + funding split | Payouts |
| Policy | VIP / tier / city / event / partner policies | Legal tax, Stripe calls |
| Commission | Party earnings | Mutate customer total |
| Validation | Coherence checks | Mutate amounts |
| Snapshot | Immutable persist | Recalculate |
| Settlement | SCT / wallet / ledger | Requote |
| Explain | Narrative breakdown | Change price |
| Audit | Config history | Price math |
| Simulator | What-if scenarios | Write production charges |

Detailed per-engine docs: `docs/architecture/pricing-engine/engines/`.

---

## 6. Rate Cards & Pricing Rules

- **Rate Cards**: tariff parameters only (no business logic).
- **Pricing Rules**: activatable/deactivatable/configurable (min/max fare, surge, airport, toll, wait, no-show, service fee, shares, etc.).
- **Policy Rules**: partner/VIP/city/event adjustments (Policy Engine).

---

## 7. Quote Snapshot

Immutable SoT after a validated quote: customer total, lines (rate/tax/fee/discount/policy/earning), algorithm version, parameter versions, inputs hash. Existing orders **must not** be recalculated when config changes.

---

## 8. Versioning

`pricing_versions` with status `draft | shadow | canary | active | retired`. Each snapshot stores `pricing_version` + `algorithm_semver`.

---

## 9. Feature Flags / Shadow / Kill Switch

| Flag | Default (Phase 0) | Purpose |
|---|---|---|
| `PRICING_ENGINE_SHADOW` | off | Parallel compute + compare logs; charge = legacy |
| `PRICING_ENGINE_CANARY_PCT` | 0 | % traffic on engine (later phases) |
| `PRICING_ENGINE_SERVICE_*` | off | Per vertical cutover |
| `PRICING_ENGINE_KILL_SWITCH` | off (when on → force legacy) | Immediate rollback |

---

## 10. Invariant tests (mandatory before any production cutover)

Validation Engine (and CI) must assert at least:

1. Customer total equals sum of customer-facing lines (after documented rounding rules).
2. Taxes are coherent (catalog, country, currency).
3. Commissions are coherent; parties sum within zero-tolerance (except documented zero-decimal align).
4. **Settlement never mutates customer price** (reads snapshot only).
5. **Snapshot is immutable** after commit.
6. No enabled rule yields an incoherent bundle (Validation fails closed → no snapshot).

---

## 11. Observability (architecture requirement)

Without changing engine math, the system shall provide:

- decision logging (rate card id, rules applied, policy ids, validation outcome);
- metrics (quote latency, shadow diff rate, validation failure rate);
- performance traces;
- error tracking;
- automatic **Legacy vs Engine** comparison when shadow is enabled.

Phase 0 ships **contracts + no-op/default-off hooks** only.

---

## 12. Performance (architecture requirement)

Caches for:

- Rate Cards  
- Pricing Rules  
- Taxes  
- Policies  

Quotes must not hit the DB for static config on every request once caches are live (Phase 1+). Phase 0 defines cache **ports** only.

---

## 13. Security (architecture requirement)

Mutations to Rate Cards, Pricing Rules, Policy Rules, Taxes, Fees, and Commissions:

- **Admin-authorized roles only** (RBAC);
- **Every change** recorded by Audit Engine (actor, timestamp, old, new, reason, version).

---

## 14. Documentation (mandatory)

Each engine document includes: responsibility, inputs, outputs, invariants, errors, examples. Location: `docs/architecture/pricing-engine/engines/`.

---

## 15. Migration plan

| Phase | Goal |
|---|---|
| **−1** | ADR (done) |
| **0 Freeze** | Flags, contracts, docs, shadow/obs/cache ports — **no user-visible change** |
| **1 Config** | Hardcodes → tables (behavior parity) |
| **2 Parallel** | Engine implementation + compare |
| **3** | Food & Package cutover |
| **4** | Ride cutover (+ configurable surge/airport/toll/wait/congestion) |
| **5** | Marketplace unification |
| **6** | Legacy cleanup |

---

## 16. Freeze clause

Architecture is **definitively frozen**. Further change requires a new ADR revision accepted explicitly. Phase 0 and later phases implement **only** what this document describes.
