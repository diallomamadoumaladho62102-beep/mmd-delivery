# Official MMD Delivery social accounts

## Single source of truth

All platform social URLs live in:

[`shared/socialLinks.ts`](../../shared/socialLinks.ts)

Consumed as `@mmd/social-links` on Web and Mobile.

**Do not hardcode** Instagram / TikTok / Facebook / website profile URLs elsewhere.

Restaurant / merchant Instagram & Facebook fields are **per-business** profile data — they are not platform official accounts.

## Where to edit accounts

1. Open `shared/socialLinks.ts`.
2. Update `url` / `username` / `shareUrl` on the network entry.
3. Set `enabled: true` only when the URL is live.
4. Run `pnpm brand:social-qr` then `pnpm brand:social-verify`.

Runtime UIs (footer, emails, download, mobile About/Help/Settings, `/brand/social`) read this file only.

Admin Site Settings shows the official links for operators; future CMS mirrors may store copies for display, but **consumption must stay** on `shared/socialLinks.ts`.

## Regenerate QR codes

```bash
pnpm brand:social-qr
```

Outputs:

- `assets/brand/qr/` (master PNG 2048 ECC-H + SVG + JSON)
- `apps/web/public/brand/qr/` (public `/brand/qr/*`)
- `apps/mobile/assets/brand/qr/`

Marketing kit page: `/brand/social`

## Verify links and QR sidecars

```bash
pnpm brand:social-verify
```

Checks HTTP reachability of active links (+ TikTok share URL) and that QR JSON sidecars match the SSOT.

## Add a new network

1. Extend `SocialNetworkId` and `OFFICIAL_SOCIAL_LINKS` in `shared/socialLinks.ts`.
2. Add a `SOCIAL_QR_TARGETS` entry if a QR is needed.
3. Add an icon path in `apps/web/src/components/site/SocialLinks.tsx` if the web icon set needs it.
4. Regenerate QR + verify.

## Disable a network

Set `enabled: false` and clear `url` (or leave empty). Active UI helpers (`getActiveSocialLinks`) will hide it automatically.
