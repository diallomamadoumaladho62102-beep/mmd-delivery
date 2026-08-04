# Phase A — Official Social Links — CLOSED

Date: 2026-08-04

## Confirmation

The entire platform consumes official MMD Delivery social accounts from a single source:

`shared/socialLinks.ts` (`@mmd/social-links`)

## Verified

- HTTP 200: Website, TikTok canonical, TikTok share, Instagram, Facebook (`pnpm brand:social-verify`)
- QR PNG/SVG/JSON sidecars match SSOT URLs
- Footers / download / business / restaurant / seller / admin site settings / emails / mobile About·Help·Settings
- Sitemap includes `/brand/social`
- Organization JSON-LD `sameAs` from active social links
- Docs: `docs/brand/OFFICIAL_SOCIAL_LINKS.md`

## Merchant exception

Restaurant Instagram/Facebook fields remain per-merchant profile data (not platform official accounts).

## Status

**Phase A is officially closed.** Phase B (Clients Premium) proceeds next.
