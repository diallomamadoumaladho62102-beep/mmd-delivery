# Dependabot: `image-size` (HIGH) — CVE-2025-71329 / CVE-2025-71330

**Alerts:** #170 (GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 JXL/HEIF), #171 (GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 ICNS)  
**Package:** `image-size` (transitive via Metro / Expo)  
**Vulnerable published range:** `<= 2.0.2`  
**Official patched npm version:** **none** (latest remains `2.0.2`, still in the advisory range)

## Fix in this repo (keep until upstream publishes a patched release)

1. pnpm override pins `image-size@1.2.1` (do **not** bump to 2.0.2).
2. pnpm patch `patches/image-size@1.2.1.patch` is declared in `package.json` → `pnpm.patchedDependencies`.
3. The lockfile records `image-size@1.2.1(patch_hash=…)`.
4. Patch contents:
   - **CVE-2025-71330** — ICNS: abort the loop if an entry length is missing or `< 8`.
   - **CVE-2025-71329** — JXL/HEIF: always advance at least 8 bytes on zero-sized boxes.

## Reproducibility

A clean install **without** the workspace `node_modules` is proven by:

```bash
node scripts/image-size-clean-install.regression.test.mjs
```

That test copies only `package.json` patch config + the patch file into a temp directory, runs `pnpm install --ignore-workspace`, and asserts the installed `icns.js` / `jxl.js` contain the CVE guards.

CI runs the same script after `pnpm install --frozen-lockfile`.

## Dependabot UI

GitHub Dependabot keys on the **published version** (`1.2.1`), not on a local pnpm patch. Alerts #170/#171 may remain open in the GitHub UI even though the installed code is patched. **Do not drop the patch** just to silence Dependabot — that would reintroduce the infinite-loop DoS.

## Status

**Mitigated in-repo** via override + pnpm patch. Re-check `npm view image-size` before replacing the patch with an official version. Only switch if a **compatible** release exists whose advisory `first_patched_version` is published and Metro/Expo still resolve to it.
