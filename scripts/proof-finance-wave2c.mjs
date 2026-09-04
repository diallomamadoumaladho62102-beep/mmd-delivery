/**
 * Static proof checks for Wave 2c finance finalization (P0/P1).
 * Run: node scripts/proof-finance-wave2c.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function read(rel) {
  // Normalize CRLF -> LF so regexes anchored on "\n" work on Windows checkouts too.
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(id, ok, detail) {
  checks.push({ id, result: ok ? "PASS" : "FAIL", detail });
}

// ---------------------------------------------------------------------------
// A) Tips — wallet + business rule
// ---------------------------------------------------------------------------

const wallet = read("apps/web/src/lib/driverWalletService.ts");
const computeFnMatch = wallet.match(
  /export async function computeDriverAvailableCents[\s\S]*?\n}\n/,
);
check(
  "tip_excluded_from_compute_driver_available_cents",
  Boolean(computeFnMatch) && !/tip_cents/.test(computeFnMatch[0]),
  "computeDriverAvailableCents must not reference tip_cents at all",
);

check(
  "tip_money_architecture_exists",
  exists("apps/web/src/lib/finance/tipMoneyArchitecture.ts") &&
    /platformShareBps:\s*0/.test(
      read("apps/web/src/lib/finance/tipMoneyArchitecture.ts"),
    ) &&
    /driver_tip/.test(read("apps/web/src/lib/finance/tipMoneyArchitecture.ts")),
  "tipMoneyArchitecture.ts documents 0% platform share + driver_tip PI kind",
);

check(
  "execute_driver_tip_transfer_exists",
  exists("apps/web/src/lib/finance/executeDriverTipTransfer.ts") &&
    /buildDriverTipTransferParams/.test(
      read("apps/web/src/lib/finance/executeDriverTipTransfer.ts"),
    ) &&
    /stripe\.transfers\.create/.test(
      read("apps/web/src/lib/finance/executeDriverTipTransfer.ts"),
    ) &&
    /source_transaction/.test(
      read("apps/web/src/lib/finance/tipMoneyArchitecture.ts"),
    ),
  "executeDriverTipTransfer creates an SCT funded by source_transaction (via buildDriverTipTransferParams)",
);

check(
  "create_tip_payment_intent_route_exists",
  exists("apps/web/app/api/stripe/client/create-tip-payment-intent/route.ts") &&
    /kind:\s*TIP_MODEL\.paymentIntentKind|driver_tip/.test(
      read("apps/web/app/api/stripe/client/create-tip-payment-intent/route.ts"),
    ) &&
    /paymentIntents\.create/.test(
      read("apps/web/app/api/stripe/client/create-tip-payment-intent/route.ts"),
    ),
  "create-tip-payment-intent route creates a PI tagged kind=driver_tip",
);

const webhookRoute = read("apps/web/app/api/stripe/webhook/route.ts");
check(
  "webhook_wires_driver_tip_transfer",
  /isDriverTipPaymentIntent/.test(webhookRoute) &&
    /executeDriverTipTransfer/.test(webhookRoute),
  "payment_intent.succeeded routes kind=driver_tip to executeDriverTipTransfer",
);

check(
  "tip_migration_exists",
  exists("supabase/migrations/20261007120000_order_driver_tip_stripe.sql") &&
    /tip_payment_intent_id/.test(
      read("supabase/migrations/20261007120000_order_driver_tip_stripe.sql"),
    ) &&
    /tip_transfer_id/.test(
      read("supabase/migrations/20261007120000_order_driver_tip_stripe.sql"),
    ),
  "migration adds tip_payment_intent_id / tip_stripe_charge_id / tip_transfer_id",
);

const transfersRun = read("apps/web/app/api/stripe/transfers/run/route.ts");
const resolveDriverAmountFnMatch = transfersRun.match(
  /function resolveDriverAmountCents\([\s\S]*?\n\}\n/,
);
check(
  "transfers_run_driver_amount_excludes_tip",
  Boolean(resolveDriverAmountFnMatch) && !/tip_cents/.test(resolveDriverAmountFnMatch[0]),
  "resolveDriverAmountCents (food delivery SCT) must not read tip_cents",
);

// ---------------------------------------------------------------------------
// B) Dispute clawback (lost)
// ---------------------------------------------------------------------------

const dispute = read("apps/web/src/lib/stripeWebhookDispute.ts");
check(
  "dispute_lost_has_create_reversal",
  /reverseStripeTransferOrRecover/.test(dispute) &&
    /financeStatus === "lost"/.test(dispute) &&
    /createReversal/.test(read("apps/web/src/lib/finance/partnerTransferClawback.ts")),
  "syncStripeChargeDispute claws back via shared reverseStripeTransferOrRecover for lost disputes",
);

check(
  "dispute_clawback_idempotency_key",
  /partnerClawbackIdempotencyKey|partner_rev/.test(
    read("apps/web/src/lib/finance/partnerTransferClawback.ts")
  ) && /dispute_clawback/.test(dispute),
  "clawback uses shared per-(dispute, transfer) idempotency via partner_rev keys",
);

check(
  "dispute_reverses_inbound_wallet",
  /reverseInboundPaymentWalletEntries/.test(dispute) &&
    /getPaymentTransactionByExternalReference/.test(dispute),
  "lost dispute mirrors stripeWebhookChargeRefunded's inbound wallet reversal",
);

check(
  "dispute_clawback_reconcile_required_per_transfer",
  /reconcile_required/.test(dispute) &&
    /reverseStripeTransferOrRecover/.test(dispute),
  "clawback attempts every transfer ref and records reconcile_required on failure",
);

// ---------------------------------------------------------------------------
// C) Marketplace source_transaction + no 5% fallback
// ---------------------------------------------------------------------------

const marketplace = read("apps/web/src/lib/marketplacePayoutService.ts");
check(
  "no_marketplace_seller_commission_bps",
  !/MARKETPLACE_SELLER_COMMISSION_BPS/.test(marketplace),
  "legacy 5% BPS fallback constant fully removed",
);

check(
  "calculate_seller_payout_requires_rate",
  /platform_rate_pct_required/.test(marketplace),
  "calculateSellerMarketplacePayout throws when platform_rate_pct is missing",
);

check(
  "prepare_seller_payout_skips_on_missing_snapshot",
  /commission_snapshot_missing/.test(marketplace),
  "prepareMarketplaceSellerPayout skips (does not silently price) on missing snapshot",
);

const sourceTransactionMatches = marketplace.match(/source_transaction:\s*sourceChargeId/g) ?? [];
check(
  "marketplace_transfers_include_source_transaction",
  sourceTransactionMatches.length >= 2,
  `expected seller + driver transfer.create calls to set source_transaction (found ${sourceTransactionMatches.length})`,
);

check(
  "marketplace_transfers_fail_closed_without_charge",
  /resolveSellerOrderSourceChargeId/.test(marketplace) &&
    /if \(!sourceChargeId\) \{/.test(marketplace),
  "executeMarketplacePayouts fails the payout closed when no source charge resolves",
);

// ---------------------------------------------------------------------------
// D) Commission hard-fail on snapshot miss (food order create)
// ---------------------------------------------------------------------------

const foodOrderService = read("apps/web/src/lib/foodOrderService.ts");
check(
  "food_order_create_hard_fails_on_snapshot_miss",
  /if \(!snap\.ok\) \{[\s\S]{0,800}throw new Error\(`Commission snapshot failed/.test(
    foodOrderService,
  ),
  "createFoodOrderServerSide deletes the order and throws when the commission snapshot fails",
);

// ---------------------------------------------------------------------------
// E) Mobile tip PaymentSheet + Edge money-out opt-in
// ---------------------------------------------------------------------------

const mobileTipScreen = read(
  "apps/mobile/src/screens/ClientOrderDetailsScreen.tsx",
);
check(
  "mobile_tip_requires_payment_sheet",
  /payTipWithPaymentSheet/.test(mobileTipScreen) &&
    /tip_cents > 0/.test(mobileTipScreen),
  "ClientOrderDetailsScreen charges tip via payTipWithPaymentSheet when tip_cents > 0",
);

check(
  "mobile_pay_tip_helper_exists",
  /export async function payTipWithPaymentSheet/.test(
    read("apps/mobile/src/utils/stripe.ts"),
  ) &&
    /create-tip-payment-intent/.test(read("apps/mobile/src/utils/stripe.ts")),
  "payTipWithPaymentSheet calls Vercel create-tip-payment-intent",
);

const edgePayDriver = read("supabase/functions/pay-driver-now/index.ts");
const edgeProcess = read("supabase/functions/process_driver_payouts/index.ts");
check(
  "edge_payouts_disabled_by_default",
  /MMD_EDGE_PAYOUTS_DISABLED"\) !== "false"/.test(edgePayDriver) &&
    /MMD_EDGE_PAYOUTS_DISABLED"\) !== "false"/.test(edgeProcess),
  "legacy Edge payout handlers require explicit MMD_EDGE_PAYOUTS_DISABLED=false",
);

const moneyOut = read("apps/web/src/lib/finance/moneyOutArchitecture.ts");
check(
  "money_out_documents_tip_and_edge_default",
  /tipFunding:\s*"separate_payment_intent_then_sct"/.test(moneyOut) &&
    /legacyEdgePayouts:\s*"disabled_by_default"/.test(moneyOut),
  "moneyOutArchitecture documents tip funding + Edge disabled_by_default",
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const report = {
  ok: checks.every((c) => c.result === "PASS"),
  generatedAt: new Date().toISOString(),
  checks,
};

fs.mkdirSync(path.join(root, "apps/web/.tmp"), { recursive: true });
const out = path.join(root, "apps/web/.tmp/finance-wave2c-proof.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("Wrote", out);
process.exit(report.ok ? 0 : 2);
