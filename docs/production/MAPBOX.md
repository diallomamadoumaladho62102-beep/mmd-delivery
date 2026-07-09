# Mapbox — production source of truth

## Canonical tokens

| Variable | Where | Purpose | Secret? |
|----------|-------|---------|---------|
| `MAPBOX_ACCESS_TOKEN` | Vercel (server) | Geocode, Directions, **all paid quotes** (taxi/food/errand), `/api/mapbox/*` | **Yes — never `NEXT_PUBLIC_` / `EXPO_PUBLIC_`** |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Vercel (web client) | Map tiles only (`react-map-gl`) | Public `pk.*` only |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | EAS Production | Mobile map tiles + on-device navigation Directions | Public `pk.*` only |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | EAS (build secret) | Download `@rnmapbox/maps` native SDK at **build time** | **Yes — build-only, not in app JS** |

## Deprecated / do not use for new setup

| Variable | Status |
|----------|--------|
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Temporary **public** alias for `NEXT_PUBLIC_MAPBOX_TOKEN`. Keep until Vercel cleaned; do not use for server routing. |
| `MAPBOX_DOWNLOADS_TOKEN` | Legacy EAS duplicate of `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`. Prefer removing after confirming builds use `RNMAPBOX_*` only. |
| `MAPBOX_TOKEN` | Removed from mobile resolution. Use `EXPO_PUBLIC_MAPBOX_TOKEN` only. |

## Fail-closed paid pricing

Paid server quotes **must** use Mapbox Directions with `MAPBOX_ACCESS_TOKEN`:

- Taxi → `taxiMapbox.ts`
- Food / errand → `mapboxRoute.getDistanceAndEta()` → `MAPBOX_ACCESS_TOKEN`
- Mobile estimates → `POST /api/mapbox/compute-distance` (server token)
- Legacy web order preview → same compute-distance API (no Haversine)

If Directions fails or the token is missing → **reject the quote**. Never fall back to Haversine for money.

## Ops checks

```bash
# Vercel names
npx vercel env ls production | findstr MAPBOX

# EAS names
eas env:list production --format short

# Gates
node scripts/verify-production-env-gates.mjs
node scripts/verify-b6-eas-secrets.mjs
```

## Dashboard cleanup (recommended)

1. **Vercel** → Project → Settings → Environment Variables  
   - Keep: `MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`  
   - Optional remove after redeploy: `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` (only if identical to `NEXT_PUBLIC_MAPBOX_TOKEN`)

2. **Expo EAS** → Project → Environment variables → Production  
   - Keep: `EXPO_PUBLIC_MAPBOX_TOKEN`, `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`  
   - Remove duplicate `MAPBOX_DOWNLOADS_TOKEN` if present and builds succeed with `RNMAPBOX_*` only

3. **Mapbox account** → Tokens  
   - Public token: URL restrictions for `www.mmddelivery.com` + mobile apps  
   - Secret/server token: no public URL exposure; used only on Vercel server
