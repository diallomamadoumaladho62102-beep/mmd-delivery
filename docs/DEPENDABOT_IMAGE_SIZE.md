# Dependabot / Snyk: `image-size` (CVE-2025-71329 / CVE-2025-71330)

There is **no official patched `image-size` npm release** (latest `2.0.2` is still in the advisory range).

MMD Delivery on Expo 54 removes the package from the graph by pinning **Metro 0.83.8**, which vendored the parsers ([metro@0.83.8](https://github.com/facebook/metro/releases/tag/v0.83.8)).

- Expo remains `~54.0.36`
- React Native remains `0.81.5`
- `patches/image-size@1.2.1.patch` is kept as a fallback file only

See `docs/security/DEPENDABOT-IMAGE-SIZE.md`.
