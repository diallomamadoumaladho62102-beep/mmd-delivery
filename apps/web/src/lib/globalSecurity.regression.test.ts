import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const errandsCreate = readRepo("apps/web/app/api/errands/create/route.ts");
assert.match(errandsCreate, /resolveErrandServerSubtotal/);
assert.match(errandsCreate, /client subtotal ignored/);

const errandPricing = readRepo("apps/web/src/lib/errandServerPricing.ts");
assert.match(errandPricing, /never trust client/i);

const passwordReset = readRepo(
  "apps/web/app/api/auth/transactional/password-reset/route.ts",
);
assert.doesNotMatch(passwordReset, /body\?\.resetUrl/);
assert.match(passwordReset, /generateLink/);
assert.match(passwordReset, /allowedResetRedirectBase/);

const pushNotify = readRepo("apps/web/app/api/chat/push-notify/route.ts");
assert.match(pushNotify, /targetAllowed/);
assert.match(pushNotify, /targetUserId/);

const chatMessages = readRepo("apps/web/app/api/chat/messages/route.ts");
assert.match(chatMessages, /resolveAuthorizedChatPushTarget/);

const driverReport = readRepo(
  "apps/web/app/api/client/driver-identity/report/route.ts",
);
assert.match(driverReport, /order_id_required/);
assert.match(driverReport, /driver_order_mismatch/);
assert.match(driverReport, /is_order_message_participant/);

const cronAuth = readRepo("apps/web/src/lib/cronAuth.ts");
assert.match(cronAuth, /isDeployedRuntime/);

const healthAuth = readRepo("apps/web/src/lib/internalHealthAuth.ts");
assert.match(healthAuth, /isDeployedRuntime/);

const syncStuck = readRepo("apps/web/app/api/stripe/admin/sync-stuck/route.ts");
assert.match(syncStuck, /isProductionRuntime\(\)/);

const roadSafety = readRepo("supabase/functions/road-safety-events/index.ts");
assert.match(roadSafety, /getUser/);
assert.match(roadSafety, /unauthorized/);

const migration = readRepo(
  "supabase/migrations/20261122200000_global_security_hardening.sql",
);
assert.match(migration, /v_subtotal := greatest/);
assert.match(migration, /site_media_public_read/);

const markDrPaid = readRepo(
  "apps/web/app/api/stripe/mark-delivery-request-paid/route.ts",
);
assert.match(markDrPaid, /confirm-delivery-request-paid/);

console.log("globalSecurity.regression.test.ts — PASS");
