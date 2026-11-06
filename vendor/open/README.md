# open 8.4.3

Local patch of the CommonJS `open` package used by Expo and React Native dev tooling.
PowerShell arguments are single-quoted so `$ ` and embedded quotes cannot change the command (CVE-2026-119025 / SNYK-JS-OPEN-22112123).
This version is not an npm release. Upstream `open@11` contains the official fix but is ESM-only and cannot be loaded by `require("open")` in `@react-native/dev-middleware@0.81.5`.

License: MIT. Copyright (c) Sindre Sorhus.
