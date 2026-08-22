# Dependabot: `image-size` (HIGH) — risk assessment

**Alerts:** #170 (GHSA-5p2g-fcmc-qvqq), #171 (GHSA-w3rx-r6r6-pgpr)  
**Package:** `image-size` (transitive)  
**Vulnerable range:** `<= 2.0.2`  
**Patched version:** **none published** (as of 2026-08-22)

## CVE summary

Denial-of-service via infinite loop when parsing crafted ICNS, JXL, or HEIF image buffers. Requires feeding malicious image bytes to the parser.

## MMD exposure

| Factor | Assessment |
|--------|------------|
| **Direct dependency** | No — transitive only |
| **pnpm override** | Root `package.json` pins `image-size@1.2.1` (below vulnerable 2.x range in advisory) |
| **Runtime path** | Typically pulled through build/tooling (e.g. Metro/Expo asset pipeline), not user-upload parsing in production API handlers |
| **Exploitability in prod** | **Low** — no production code path identified that parses untrusted ICNS/JXL/HEIF via `image-size` 2.x; override keeps 1.2.1 |
| **Upload hardening** | `uploadSecurity` + MIME allowlists block exotic formats on avatars/docs |

## Action

1. **Keep** pnpm override `image-size@1.2.1` until upstream publishes 2.0.3+ with fix.
2. **Do not** bump to 2.0.2 without verified patch.
3. **Re-scan** after Dependabot reports `first_patched_version`.
4. Optional: dismiss alerts with reason *"transitive override to 1.2.1; 2.x not used in runtime upload paths"* once GitHub reflects override.

## Status

**OPEN (documented)** — not fixable without upstream patch; risk mitigated by version override and upload guards.
