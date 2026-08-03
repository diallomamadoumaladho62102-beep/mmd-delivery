# Feature Flags — Pricing Engine

All defaults keep **legacy** as the only charge path.

| Env var | Type | Default | Phase 0 | Later |
|---|---|---|---|---|
| `PRICING_ENGINE_SHADOW` | bool | false | May be set in non-prod for harness only; **not wired to charge routes** | Shadow compare logs |
| `PRICING_ENGINE_CANARY_PCT` | 0–100 | 0 | Ignored for charge (`resolveChargePath` → legacy) | % engine traffic |
| `PRICING_ENGINE_SERVICE_RIDE` | bool | false | Ignored for charge | Ride cutover |
| `PRICING_ENGINE_SERVICE_FOOD` | bool | false | Ignored for charge | Food cutover |
| `PRICING_ENGINE_SERVICE_PACKAGE` | bool | false | Ignored for charge | Package cutover |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | bool | false | Ignored for charge | Marketplace cutover |
| `PRICING_ENGINE_KILL_SWITCH` | bool | false | When true → force legacy + disable shadow | Immediate rollback |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | 0–100 | 100 | % of eligible quotes to shadow when SHADOW on | Phase 2 sampling |

## Kill Switch

When `PRICING_ENGINE_KILL_SWITCH=true`, charge path **must** be legacy and shadow compare is disabled.  
`resolveChargePath()` returns `"legacy"` while migration phase &lt; 3 (hard gate).

## Phase 2 enablement (shadow only — no charge)

```bash
PRICING_ENGINE_SHADOW=true
PRICING_ENGINE_KILL_SWITCH=false
PRICING_ENGINE_SHADOW_SAMPLE_PCT=100
```

Never set service cutover flags or canary &gt; 0 during Phase 2.

## Phase 3 enablement (Food & Package charge cutover)

Defaults keep **legacy** charge until ops enables flags. Progressive canary — **no direct jump to 100% in production**.

```bash
# Staging example — Food first at low canary
PRICING_ENGINE_SERVICE_FOOD=true
PRICING_ENGINE_SERVICE_PACKAGE=false
PRICING_ENGINE_CANARY_PCT=5
PRICING_ENGINE_KILL_SWITCH=false
PRICING_ENGINE_SHADOW=true

# Keep Ride / Marketplace OFF
PRICING_ENGINE_SERVICE_RIDE=false
PRICING_ENGINE_SERVICE_MARKETPLACE=false
```

Rollback: `PRICING_ENGINE_KILL_SWITCH=true` or `CANARY_PCT=0` or service flag `false`.

## Phase 4 enablement (Ride charge cutover)

Defaults keep **legacy** Ride charge until ops enables flags. Progressive canary — **no direct jump to 100% in production**. Marketplace stays OFF.

```bash
# Staging example — Ride at low canary
PRICING_ENGINE_SERVICE_RIDE=true
PRICING_ENGINE_CANARY_PCT=5
PRICING_ENGINE_KILL_SWITCH=false
PRICING_ENGINE_SHADOW=true

# Keep Marketplace OFF
PRICING_ENGINE_SERVICE_MARKETPLACE=false
```

Rollback Ride-only: `PRICING_ENGINE_SERVICE_RIDE=false`. Global: Kill Switch.

## Phase 5 enablement (Marketplace charge cutover)

Defaults keep **legacy** Marketplace charge until ops enables flags. Progressive canary — **no direct jump to 100% in production**.

```bash
# Staging example — Marketplace at low canary
PRICING_ENGINE_SERVICE_MARKETPLACE=true
PRICING_ENGINE_CANARY_PCT=5
PRICING_ENGINE_KILL_SWITCH=false
PRICING_ENGINE_SHADOW=true
```

Rollback Marketplace-only: `PRICING_ENGINE_SERVICE_MARKETPLACE=false`. Global: Kill Switch.
