import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  areFontsReady,
  BOOT_AUTH_TIMEOUT_MS,
  BOOT_FONT_TIMEOUT_MS,
  BOOT_SHELL_TIMEOUT_MS,
  CLIENT_HOME_FETCH_TIMEOUT_MS,
  withTimeout,
} from "./bootFailOpen";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("fonts ready when loaded", () => {
  assert.equal(
    areFontsReady({ fontsLoaded: true, fontError: null, fontTimedOut: false }),
    true,
  );
});

test("fonts ready on error (fail-open)", () => {
  assert.equal(
    areFontsReady({
      fontsLoaded: false,
      fontError: new Error("font"),
      fontTimedOut: false,
    }),
    true,
  );
});

test("fonts ready on timeout (fail-open)", () => {
  assert.equal(
    areFontsReady({ fontsLoaded: false, fontError: null, fontTimedOut: true }),
    true,
  );
});

test("fonts not ready while still loading", () => {
  assert.equal(
    areFontsReady({ fontsLoaded: false, fontError: null, fontTimedOut: false }),
    false,
  );
});

test("App.tsx uses boot fail-open for fonts and auth", () => {
  const src = fs.readFileSync(path.join(mobileRoot, "App.tsx"), "utf8");
  assert.match(src, /areFontsReady/);
  assert.match(src, /BOOT_AUTH_TIMEOUT_MS/);
  assert.match(src, /BOOT_FONT_TIMEOUT_MS/);
  assert.match(src, /withTimeout/);
  assert.match(src, /fontError/);
});

test("AppRootShell has import timeout fail-open", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/components/AppRootShell.tsx"),
    "utf8",
  );
  assert.match(src, /BOOT_SHELL_TIMEOUT_MS/);
  assert.match(src, /withTimeout/);
});

test("StripeGate never blocks RoleSelect/Login on config error", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/lib/StripeGate.tsx"),
    "utf8",
  );
  assert.match(src, /AppNavigator/);
  assert.match(src, /non-blocking/);
  assert.doesNotMatch(src, /return <StripeConfigurationError/);
});

test("RoleSelect scroll does not center-clip on tablet", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/screens/RoleSelectScreen.tsx"),
    "utf8",
  );
  assert.match(src, /justifyContent:\s*"flex-start"/);
  assert.match(src, /loginEntryBtn|client\.auth\.loginBtn/);
  assert.match(src, /opacityFailsafe/);
});

test("ClientAuth scroll uses flex-start (iPad safe)", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/screens/ClientAuthScreen.tsx"),
    "utf8",
  );
  assert.match(src, /justifyContent:\s*"flex-start"/);
});

test("boot timeout constants are finite and sane", () => {
  assert.ok(BOOT_AUTH_TIMEOUT_MS >= 3000 && BOOT_AUTH_TIMEOUT_MS <= 15_000);
  assert.ok(BOOT_FONT_TIMEOUT_MS >= 2000 && BOOT_FONT_TIMEOUT_MS <= 10_000);
  assert.ok(BOOT_SHELL_TIMEOUT_MS >= 5000 && BOOT_SHELL_TIMEOUT_MS <= 20_000);
  assert.ok(
    CLIENT_HOME_FETCH_TIMEOUT_MS >= 3000 &&
      CLIENT_HOME_FETCH_TIMEOUT_MS <= 15_000,
  );
});

test("ClientHome fetch uses fail-open timeout", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/screens/ClientHomeScreen.tsx"),
    "utf8",
  );
  assert.match(src, /CLIENT_HOME_FETCH_TIMEOUT_MS/);
  assert.match(src, /client_home_fetch/);
  assert.match(src, /withTimeout\(/);
});

void withTimeout(Promise.resolve(true), 50, "unit_ok").then((v) => {
  assert.equal(v, true);
  console.log("ok withTimeout resolves");
  return withTimeout(new Promise(() => undefined), 40, "unit").then(
    () => {
      throw new Error("expected timeout");
    },
    (err: Error) => {
      assert.match(String(err.message), /unit_timeout_40ms/);
      console.log("ok withTimeout rejects after ms");
      console.log("ipadLoginBoot.regression passed");
    },
  );
});
