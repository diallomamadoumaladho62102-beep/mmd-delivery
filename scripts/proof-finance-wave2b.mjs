/**
 * Static proof checks for Wave 2b financial architecture closure.
 * Run: node scripts/proof-finance-wave2b.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function check(id, ok, detail) {
  checks.push({ id, result: ok ? "PASS" : "FAIL", detail });
}

const cashout = read("apps/web/app/api/wallet/driver-cashout/route.ts");
check(
  "driver_cashout_no_admin_pay_driver_now",
  !/\.rpc\(\s*["']admin_pay_driver_now["']/.test(cashout) &&
    !/\.rpc\(\s*["']finalize_driver_payout["']/.test(cashout),
  "driver-cashout must not call admin_pay_driver_now / finalize_driver_payout",
);

check(
  "driver_cashout_uses_connect_balance_payout",
  (/balance\.retrieve/.test(cashout) || /fetchConnectUsdBalanceCents/.test(cashout)) &&
    /payouts\.create/.test(cashout) &&
    /createPayoutTransaction/.test(cashout) &&
    /MONEY_OUT_MODEL/.test(cashout),
  "cashout uses Connect balance + Stripe payout + audit tx",
);

check(
  "money_out_architecture_exists",
  exists("apps/web/src/lib/finance/moneyOutArchitecture.ts") &&
    /stripe_transfer_sct/.test(read("apps/web/src/lib/finance/moneyOutArchitecture.ts")),
  "moneyOutArchitecture.ts exports MONEY_OUT_MODEL",
);

const webhook = read("apps/web/app/api/stripe/webhook/route.ts");
check(
  "handled_dispute_created",
  /charge\.dispute\.created/.test(webhook) &&
    /syncStripeChargeDispute/.test(webhook),
  "HANDLED includes charge.dispute.created and wires sync",
);

check(
  "reverse_inbound_migration_exists",
  exists("supabase/migrations/20261006120000_reverse_inbound_payment_wallet_entries.sql") &&
    /reverse_inbound_payment_wallet_entries/.test(
      read("supabase/migrations/20261006120000_reverse_inbound_payment_wallet_entries.sql"),
    ),
  "migration adds reverse_inbound_payment_wallet_entries",
);

const marketplace = read("apps/web/src/lib/marketplacePayoutService.ts");
check(
  "is_seller_order_paid_checks_refund_status",
  /function isSellerOrderPaid[\s\S]*refund_status[\s\S]*disputed/.test(marketplace) &&
    /refund_status/.test(marketplace),
  "isSellerOrderPaid gates on refund_status",
);

const wallet = read("apps/web/src/lib/driverWalletService.ts");
check(
  "build_driver_wallet_has_awaiting_transfer",
  /awaiting_transfer_cents/.test(wallet) &&
    /fetchConnectUsdBalanceCents/.test(wallet) &&
    /buildDriverWalletSummary/.test(wallet),
  "buildDriverWalletSummary exposes awaiting_transfer_cents",
);

const transfersRun = read("apps/web/app/api/stripe/transfers/run/route.ts");
check(
  "transfers_run_blocks_refunded_disputed",
  /isBlockedRefundStatus/.test(transfersRun) &&
    /refund_status/.test(transfersRun),
  "transfers/run rejects refunded/disputed orders",
);

const unit = spawnSync(
  "npx",
  ["tsx", "src/lib/finance/moneyOutArchitecture.test.ts"],
  { cwd: path.join(root, "apps/web"), encoding: "utf8", shell: true },
);
check(
  "money_out_unit_test",
  unit.status === 0,
  (unit.stdout || unit.stderr || "").trim().slice(0, 200),
);

const report = {
  ok: checks.every((c) => c.result === "PASS"),
  generatedAt: new Date().toISOString(),
  checks,
};

fs.mkdirSync(path.join(root, "apps/web/.tmp"), { recursive: true });
const out = path.join(root, "apps/web/.tmp/finance-wave2b-proof.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("Wrote", out);
process.exit(report.ok ? 0 : 2);
