# Restaurant Command Center V1.1 — Ultra Premium Design

Visual and UX upgrade only. No API, Supabase, security, realtime, or business-logic changes.

## Scope

| Area | Changed |
|------|---------|
| Glassmorphism cards, typography, spacing, shadows | Yes |
| KPI sparklines + trend badges (real yesterday/today data) | Yes |
| Revenue hero, Live Ops hero, AI hero sections | Yes |
| Order distribution donut + prep gauge | Yes |
| Revenue trend bars (revenue, orders, customers) | Yes |
| Top products ranking bars | Yes |
| Driver arrival pulse animation | Yes |
| Skeleton loading states | Yes |
| i18n (4 new keys × 6 locales) | Yes |
| APIs / hooks / Mapbox logic | No |

## Before / After

Capture on device during certification (same restaurant account, same day):

| Section | V1 (before) | V1.1 (after) |
|---------|-------------|--------------|
| **Header** | Flat title + status text | Glass back button, premium status pill with live dot |
| **Revenue** | KPI card in horizontal row | Dedicated **Revenue Hero** with gold accent, sparkline, trend chip |
| **KPI row** | Plain cards, text-only deltas | Glass cards, **TrendBadge**, **MiniSparkline** from real yesterday/today values |
| **Live ops** | Section title + horizontal cards | **Hero glass panel**, subtitle, live count badge, premium chips on cards |
| **Driver cards** | Static borders | **Animated pulse** on arrived, status chips, glass depth |
| **Map** | Basic bordered map | **GlassCard** frame, driver count badge, refined pin styling |
| **Orders overview** | Inline breakdown list | **Donut** (status distribution) + **prep time gauge** |
| **Trends** | Not shown | **Revenue trend chart** (yesterday vs today bars, 3 metrics) |
| **AI Growth** | Plain list | Gold hero card, AI badge, glass recommendation tiles |
| **Top products** | List only | Rank badges + **horizontal bar ranking** by quantity sold |
| **Financial** | Basic rows | Gold glass card, impact highlight box, stat grid, trend on month growth |
| **Loading** | Spinner / text | **CommandCenterSkeleton** matching final layout |
| **Theme** | Mixed dark surfaces | Unified `#030712` base, glass borders, consistent elevation |

### Screenshot checklist

1. Loading skeleton (cold open)
2. Full scroll — top (revenue hero + KPIs)
3. Live operations carousel (driver arrived state if available)
4. Map + order insights donut
5. AI + top products + financial footer

Save as `docs/production/screenshots/command-center-v1/` and `command-center-v1.1/` for side-by-side review.

## New components

```
apps/mobile/src/features/restaurant/components/
  commandCenterTheme.ts
  GlassCard.tsx
  SectionHeroHeader.tsx
  TrendBadge.tsx
  MiniSparkline.tsx
  RevenueHeroCard.tsx
  RevenueTrendChart.tsx
  OrderDistributionDonut.tsx
  PrepTimeGauge.tsx
  OrderInsightsCard.tsx
  CommandCenterSkeleton.tsx
```

## i18n keys added

- `restaurant.commandCenter.yesterday`
- `restaurant.commandCenter.revenueTrend`
- `restaurant.commandCenter.liveOperationsHero`
- `restaurant.commandCenter.ai.heroBadge`

All six locales: `en`, `fr`, `es`, `ar`, `zh`, `ff`.

## Performance impact assessment

| Factor | Impact | Notes |
|--------|--------|-------|
| **Network** | None | Same two GET endpoints; no extra fetches |
| **Realtime** | None | Hook unchanged |
| **Render tree** | Low ↑ | ~10 presentational components; all `memo()` |
| **Animations** | Low | RN `Animated` with `useNativeDriver: true` (pulse, skeleton shimmer) |
| **Charts** | Low | View-based bars/donut/sparklines — no SVG/chart library |
| **Mapbox** | None | Same `MapView` instance; styling wrapper only |
| **Memory** | Negligible | No new caches or subscriptions |
| **Bundle** | +~8 KB est. | New TSX only; no new npm dependencies |

**Recommendation:** Safe for production. If jank appears on low-end Android during horizontal scroll + map + pulse, disable driver pulse via `variant !== "arrived"` check (already scoped). Profile with React DevTools / Flipper if needed during device certification.

## Verification

```bash
cd apps/mobile && npx tsc --noEmit
```

Manual: open Command Center from Restaurant Home (👑 Dashboard), pull-to-refresh, accept/reject/map focus unchanged from V1.

## Out of scope (V2)

New business features, extra API fields, Reanimated dependency, mock/demo data.
