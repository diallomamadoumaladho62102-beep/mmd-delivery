import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MOBILE_LINKING_SCREEN_PATHS,
  MOBILE_UNIVERSAL_LINK_PATHS,
  isAasaPathCovered,
} from "../../../mobile/src/lib/deepLinkPaths";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const aasaPath = path.join(
  repoRoot,
  "apps/web/public/.well-known/apple-app-site-association",
);

test("every mobile linking screen path is covered by AASA patterns", () => {
  for (const linkingPath of Object.values(MOBILE_LINKING_SCREEN_PATHS)) {
    assert.equal(
      isAasaPathCovered(linkingPath),
      true,
      `missing AASA coverage for ${linkingPath}`,
    );
  }
});

test("AASA file includes signup and auth reset paths", () => {
  const raw = fs.readFileSync(aasaPath, "utf8");
  const parsed = JSON.parse(raw) as {
    applinks?: { details?: Array<{ paths?: string[] }> };
  };
  const paths = parsed.applinks?.details?.[0]?.paths ?? [];

  assert.ok(paths.includes("/signup/*"), "expected /signup/* in AASA");
  assert.ok(paths.includes("/auth/*"), "expected /auth/* in AASA");
  assert.ok(
    paths.includes("/reset-password") || paths.some((p) => p.includes("reset-password")),
    "expected reset-password path in AASA",
  );

  for (const required of MOBILE_UNIVERSAL_LINK_PATHS) {
    assert.ok(
      paths.includes(required),
      `AASA missing declared universal path ${required}`,
    );
  }
});

test("assetlinks.json includes Android package and fingerprint", () => {
  const assetPath = path.join(
    repoRoot,
    "apps/web/public/.well-known/assetlinks.json",
  );
  const parsed = JSON.parse(fs.readFileSync(assetPath, "utf8")) as Array<{
    target?: { package_name?: string; sha256_cert_fingerprints?: string[] };
  }>;
  assert.equal(parsed[0]?.target?.package_name, "com.maladho2025.mmddelivery");
  assert.ok((parsed[0]?.target?.sha256_cert_fingerprints?.length ?? 0) > 0);
});

test("required device universal link paths are declared", () => {
  const devicePaths = [
    "signup/client",
    "signup/driver",
    "signup/restaurant",
    "auth/reset-password",
  ];
  for (const p of devicePaths) {
    assert.equal(isAasaPathCovered(p), true, `AASA must cover /${p}`);
  }
  assert.equal(isAasaPathCovered("r/TESTCODE"), true, "AASA must cover /r/*");
});
