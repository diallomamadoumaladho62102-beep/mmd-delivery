# deepmerge (MMD vendor)

Local replacement for npm `deepmerge@4.3.1`, which is still the latest registry release and is vulnerable to CVE-2026-93753 (`SNYK-JS-DEEPMERGE-19964053`, `GHSA-gcqx-w48m-w2h4`).

Upstream PR [TehShrike/deepmerge#274](https://github.com/TehShrike/deepmerge/pull/274) was closed without a release. This copy keeps the 4.3.1 behavior and adds a name denylist in both `mergeObject` loops:

- `__proto__`
- `constructor`
- `prototype`

Those keys are dropped. They are not written onto the object returned by `merge()`. `Object.prototype` was already left untouched by 4.3.1. The denylist closes the three bypasses of `propertyIsUnsafe`: a null-prototype target, a null placeholder, and an own `__proto__` key.

The package version is `4.3.2` so the lockfile cannot be read as the npm tarball `4.3.1`. It is not an upstream release. `@expo/config@12` (Expo SDK 54) is the only consumer, via `modifyConfigAsync`.
