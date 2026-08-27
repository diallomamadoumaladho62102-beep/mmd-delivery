/**
 * Driver wallet Instant Cash Out copy must not imply debit-card-only.
 * Stripe Instant can land on an Instant-eligible bank (e.g. Chase).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const screen = fs.readFileSync(
  path.join(here, "../screens/DriverWalletScreen.tsx"),
  "utf8",
);

assert.match(screen, /Instant-eligible bank or debit card/);
assert.doesNotMatch(
  screen,
  /Add Instant debit card, or wait for Sunday bank payout/,
);
assert.match(screen, /summary\.available_cents/);
assert.match(screen, /requestWalletCashOut/);

const locales = ["en", "fr", "es", "ar", "zh", "ff"];
for (const lang of locales) {
  const common = JSON.parse(
    fs.readFileSync(
      path.join(here, `../i18n/locales/${lang}/common.json`),
      "utf8",
    ),
  );
  const wallet = common?.driver?.wallet;
  assert.ok(
    String(wallet?.available?.waitSunday ?? "").trim().length > 10,
    `${lang} driver.wallet.available.waitSunday`,
  );
  assert.ok(
    String(wallet?.cashoutReason?.instant ?? "").trim().length > 10,
    `${lang} driver.wallet.cashoutReason.instant`,
  );
}

console.log("driverWalletInstantDest.test.ts OK");
