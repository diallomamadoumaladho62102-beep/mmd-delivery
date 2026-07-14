# Security Policy — MMD Delivery

## Supported versions

Security fixes are applied on the `main` branch only (production web app and EAS production mobile builds).

| Channel | Supported |
| --- | --- |
| `main` (production) | Yes |
| Feature / PR branches | Best effort until merged |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities that could expose user data, payments, or infrastructure credentials.

Prefer one of:

1. GitHub **Security Advisories** for this repository (Private vulnerability reporting), if enabled.
2. Email the security contact listed in App Store / Google Play / legal pages for MMD Delivery.
3. Contact the repository admin through a private channel.

Include:

- affected surface (web, iOS, Android, API route);
- reproduction steps;
- impact assessment (auth bypass, PII, payment, RCE, secret exposure);
- any related commit SHA or release version.

We aim to acknowledge reports within a few business days.

## Secrets and credentials

- Never commit `.env`, `.env.local`, service-role keys, Stripe secret keys, Mapbox **secret** tokens (`sk.*` download tokens), Apple/Google signing materials, or private keys.
- Public client tokens (`EXPO_PUBLIC_*`, Mapbox `pk.*`, Stripe `pk_*`) are still sensitive to abuse — prefer EAS / Vercel environment injection over hardcoding.
- If a secret was committed historically, **rotate it** in the provider console even if it was later removed from `main`.

## Disclosure

We prefer coordinated disclosure. Please give us reasonable time to patch before public write-ups.
