# Snyk: `inflight@1.0.6` (SNYK-JS-INFLIGHT-6095116)

**Severity:** Medium (CWE-772 memory leak)  
**Official npm patched version:** none (`inflight@1.0.6` is the latest and deprecated)

## Why this ignore exists

We accept **Option A** — a targeted Snyk policy ignore — for this single transitive vulnerability only. We do **not** migrate Expo, React Native, or override `glob` / `inflight` to silence Snyk.

### Dependency chain

`inflight@1.0.6` is pulled only through **`glob@7.2.3`**:

| Parent path | Role |
|-------------|------|
| `react-native@0.81.5` | RN codegen / build tooling |
| `@react-native/codegen@0.81.5` | Babel / Metro codegen |
| `rimraf@3.0.2` ← `@react-native/dev-middleware` ← `@expo/cli` | Expo dev CLI |
| `test-exclude@6.0.0` ← `babel-jest` | Jest / test coverage |

There is **no** `inflight` path under `apps/web`. Nothing under `apps/mobile/src` imports `inflight`.

### No upstream fix

- No corrected `inflight` release exists on npm.
- Replacing `glob@7` with `glob@9`/`glob@10` via overrides is **out of scope** (breaks RN 0.81 / Expo 54 tooling).
- Snyk’s automated remediation toward **Expo 56** is incorrect for this repo and must not be applied.

### Runtime exposure

The affected code runs in **build / dev / test** tooling, not in the production mobile bundle. React Native maintainers classify this class of `glob@7` / `inflight` findings as build-time only ([facebook/react-native#47866](https://github.com/facebook/react-native/issues/47866)).

A structural fix requires a **future** React Native / Expo stack upgrade when upstream removes `glob@7`.

## Policy file

Root [`.snyk`](../../.snyk) ignores **only**:

- **Vulnerability ID:** `SNYK-JS-INFLIGHT-6095116`
- **Package path:** `inflight@1.0.6`

No other Snyk ignores or patches are defined in that file.

## Reproducibility

```bash
node scripts/snyk-inflight-policy.regression.test.mjs
node scripts/image-size-clean-install.regression.test.mjs
node scripts/dependency-audit.mjs
```

## What we did not change

- Expo **54** / React Native **0.81.5** / Metro **0.83.8**
- Apple **#121** (`CLIENT_HOME_FETCH_TIMEOUT_MS = 8_000`)
- PR **#124** Metro / `image-size` remediation
