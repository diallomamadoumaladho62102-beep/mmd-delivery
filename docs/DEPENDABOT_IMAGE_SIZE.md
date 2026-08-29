# Dependabot HIGH: image-size (CVE-2025-71329 / CVE-2025-71330)

GitHub still shows two HIGH alerts on `image-size` (`<= 2.0.2`) with **no official patched npm release** (maintainer archived the GitHub repo).

## What we already did in-repo

- pnpm override pins `image-size` to `1.2.1`
- `patches/image-size@1.2.1.patch` closes the ICNS / JXL / HEIF infinite-loop paths
- `scripts/image-size-clean-install.regression.test.mjs` proves the patch applies

## Why we did not bump the package

There is no safe upstream version to upgrade to. A community fork (`image-size-next`) would be a mass-transitive swap and is not required while the pin+patch remains.

**OPS:** leave the Dependabot alerts open or dismiss as “patched in-repo” after review. Do not `pnpm update` the whole tree for this.
