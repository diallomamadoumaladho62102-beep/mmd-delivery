# `decode-uri-component` (GHSA-vcc3-ghjq-m6fr / CVE-2026-45822)

**Official npm patched version:** `0.5.0` — ESM-only (`"type": "module"`).  
**Consumer:** `query-string@7.1.3` → `@react-navigation/core` (CJS `require()`).

Do **not** `pnpm.overrides` `decode-uri-component` to the npm `0.5.0` tarball.  
`query-string@7` does `require('decode-uri-component')`; the ESM build throws `ERR_REQUIRE_ESM` / `TypeError` and breaks React Navigation.

`query-string@8+` / `@9.5.0` are also ESM and break `@react-navigation/core`’s namespace import (`queryString.parse` becomes `undefined`). There is no upstream React Navigation release that drops `query-string@^7.1.3`.

## Fix in this repo

Root override:

```json
"decode-uri-component": "file:vendor/decode-uri-component"
```

`vendor/decode-uri-component` is a **CJS backport of the official 0.5.0 linear-time scanner** (MIT, Sam Verschueren). Version is `0.5.0` so Dependabot’s `<= 0.4.2` range no longer matches. React Navigation and `query-string@7.1.3` stay unchanged.

## Reproducibility

```bash
node scripts/decode-uri-component-cjs.regression.test.mjs
```
