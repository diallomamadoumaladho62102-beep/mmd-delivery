/**
 * Regression: babel-plugin-module-resolver must work with the glob@14 override.
 * glob@14 exports ESM-style CJS (`__esModule: true` without usable `default`),
 * which breaks the plugin's `_interopRequireDefault(require("glob")).default.hasMagic`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(
  pkg.pnpm?.patchedDependencies?.["babel-plugin-module-resolver@5.0.3"],
  "patches/babel-plugin-module-resolver@5.0.3.patch",
  "expected pnpm patchedDependencies entry for babel-plugin-module-resolver@5.0.3"
);
assert.equal(
  fs.existsSync(path.join(root, "patches/babel-plugin-module-resolver@5.0.3.patch")),
  true,
  "missing patches/babel-plugin-module-resolver@5.0.3.patch"
);

const normalizePath = path.join(
  root,
  "node_modules/babel-plugin-module-resolver/lib/normalizeOptions.js"
);
const src = fs.readFileSync(normalizePath, "utf8");
assert.match(
  src,
  /_globModule\s*=\s*require\("glob"\)/,
  "installed babel-plugin-module-resolver must use patched glob interop"
);
assert.doesNotMatch(
  src,
  /_glob\.default\.hasMagic/,
  "installed plugin must not call glob.default.hasMagic (broken on glob@14)"
);

const glob = require("glob");
assert.equal(typeof glob.hasMagic, "function");
assert.equal(typeof glob.sync, "function");

const babel = require("@babel/core");
const transformed = babel.transformSync(
  'import x from "@/lib/guestMarketFeatures"; export default x;',
  {
    filename: path.join(root, "apps/mobile/src/tmp-glob14-check.js"),
    configFile: path.join(root, "apps/mobile/babel.config.js"),
    babelrc: false,
  }
);
assert.ok(transformed?.code, "babel transform with module-resolver must succeed");
assert.match(
  transformed.code,
  /guestMarketFeatures/,
  "alias @/ must resolve via module-resolver under glob@14"
);

console.log("babel-module-resolver-glob14.regression.test.mjs: ok");
