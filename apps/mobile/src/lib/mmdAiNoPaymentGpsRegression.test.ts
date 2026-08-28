import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const location = fs.readFileSync(path.join(here, "location.ts"), "utf8");
const screen = fs.readFileSync(path.join(here, "../screens/MmdAiScreen.tsx"), "utf8");

assert.match(location, /promptAndroidBackgroundLocationDisclosure/);
assert.match(location, /await Location.requestBackgroundPermissionsAsync/);
assert.doesNotMatch(screen, /requestBackgroundPermissionsAsync/);
assert.doesNotMatch(screen, /ACCESS_BACKGROUND_LOCATION/);

const wallet = fs.readFileSync(path.join(here, "walletApi.ts"), "utf8");
assert.match(wallet, /requestWalletCashOut/);

console.log("mmdAiNoPaymentGpsRegression.test.ts OK");
