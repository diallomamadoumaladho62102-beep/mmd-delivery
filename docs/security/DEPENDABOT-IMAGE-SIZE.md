# `image-size` (CVE-2025-71329 / CVE-2025-71330)

**Official npm patched version:** none (`image-size` latest remains `2.0.2`, still in the advisory range). Do **not** bump to `2.0.2` and do **not** swap to `image-size-next` without a Metro/Expo compatibility proof.

## Fix in this repo (Expo SDK 54)

Metro **0.83.8** (same 0.83.x line as Expo 54 / RN 0.81) [vendored image parsers and dropped the `image-size` dependency](https://github.com/facebook/metro/releases/tag/v0.83.8). Root `pnpm.overrides` pin the whole `metro*` family to `0.83.8`. After `pnpm install --frozen-lockfile`:

- `require('metro/package.json').version === '0.83.8'`
- `image-size` is **absent** from `pnpm-lock.yaml` and `node_modules`

This is **not** Expo 55 and **not** React Native 0.84. Expo stays `~54.0.36`; React Native stays `0.81.5`.

`patches/image-size@1.2.1.patch` is kept on disk as a fallback only. It is **not** in `pnpm.patchedDependencies` because `image-size` is no longer installed.

## Expo 55 is not a fix for this CVE

`expo@55.0.16` ships `@expo/metro` → `metro@0.83.6`, which still depends on `image-size@^1.0.2`. Do not bump Expo to “clear Snyk”.

## Reproducibility

```bash
node scripts/image-size-clean-install.regression.test.mjs
```
