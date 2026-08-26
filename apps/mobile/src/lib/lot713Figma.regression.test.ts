/**
 * Lots 7–13: Figma screens use real MMD APIs + i18n, never Figma placeholders.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return fs.readFileSync(path.join(here, rel), "utf8");
}

const request = read("../screens/DeliveryRequestScreen.tsx");
const details = read("../screens/ClientDeliveryRequestDetailsScreen.tsx");
const receipt = read("../screens/EntityReceiptScreen.tsx");
const biz = read("../screens/taxi/BusinessWalletScreen.tsx");
const driverWallet = read("../screens/DriverWalletScreen.tsx");
const driverOrder = read("../screens/DriverOrderDetailsScreen.tsx");
const driverRevenue = read("../screens/DriverRevenueScreen.tsx");
const linked = read("./walletLinkedJob.ts");

for (const src of [request, details, receipt, biz, driverWallet, driverOrder, driverRevenue]) {
  assert.doesNotMatch(src, /\$28\b/);
  assert.doesNotMatch(src, /\$26\.70/);
  assert.doesNotMatch(src, /\$250\.00/);
  assert.doesNotMatch(src, /\$342\.50/);
  assert.doesNotMatch(src, /Acme Logistics/);
  assert.doesNotMatch(src, /Sarah Johnson/);
  assert.doesNotMatch(src, /Brickell/);
  assert.doesNotMatch(src, /Trip #5824/);
  assert.doesNotMatch(src, /Alex Driver/);
  assert.doesNotMatch(src, /JFK Airport/);
  assert.doesNotMatch(src, /\+12% vs last week/);
}

assert.match(request, /quoteDeliveryRequest/);
assert.match(request, /createDeliveryRequest/);
assert.match(request, /ClientServiceBottomNav/);
assert.match(request, /PIN_BUTTON_ICON/);

assert.match(details, /ClientServiceBottomNav/);
assert.match(details, /DeliveryRequestReceipt/);
assert.match(details, /startMaskedCall/);
assert.match(details, /formatLocalizedDistance/);
assert.match(details, /client\.deliveryRequest\.summaryTitle/);

assert.match(receipt, /fetchReceipt/);
assert.match(receipt, /printEntityReceiptPdf/);
assert.match(receipt, /hideCustomerNav/);

assert.match(biz, /\/api\/taxi\/business\/wallet\/summary/);
assert.match(biz, /\/api\/taxi\/business\/wallet\/history/);
assert.match(biz, /\/api\/taxi\/business\/members/);
assert.match(biz, /can_manage/);
assert.match(biz, /resolveWalletLinkedJob/);
assert.match(biz, /ClientDeliveryRequestDetails/);
assert.match(biz, /readOnly/);

assert.match(driverWallet, /fetchDriverWalletSnapshot/);
assert.match(driverWallet, /requestWalletCashOut/);
assert.doesNotMatch(driverWallet, /ClientServiceBottomNav/);
assert.match(driverWallet, /DriverOrderDetails/);
assert.match(driverWallet, /availableCents/);
assert.match(driverWallet, /payout_amount_cents/);

assert.match(driverOrder, /viewer: "driver"/);
assert.match(driverOrder, /DeliveryRequestReceipt/);
assert.match(driverOrder, /TaxiReceipt/);
assert.match(driverOrder, /FoodOrderReceipt/);

assert.match(driverRevenue, /DriverOrderDetails/);
assert.match(driverRevenue, /loadTaxiDriverEarnings/);
assert.match(driverRevenue, /MMD_GLASS/);

assert.match(linked, /delivery_request/);
assert.match(linked, /taxi_ride/);

const localesDir = path.join(here, "../i18n/locales");
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const extras = JSON.parse(
    fs.readFileSync(path.join(localesDir, lang, "extras.json"), "utf8"),
  );
  assert.ok(
    String(extras?.client?.deliveryRequest?.summaryTitle ?? "").trim(),
    `${lang} missing client.deliveryRequest.summaryTitle`,
  );
  assert.ok(
    String(extras?.client?.deliveryRequest?.subtitleTracking ?? "").trim(),
    `${lang} missing client.deliveryRequest.subtitleTracking`,
  );
  assert.ok(
    String(extras?.business?.wallet?.readOnly ?? "").trim(),
    `${lang} missing business.wallet.readOnly`,
  );
  assert.ok(
    String(extras?.driver?.wallet?.confirm?.cta ?? "").trim(),
    `${lang} missing driver.wallet.confirm.cta`,
  );
}

console.log("lot713Figma.regression.test.ts OK");
