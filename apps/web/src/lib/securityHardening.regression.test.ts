import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const taxiApi = readRepo("apps/web/src/lib/taxiApi.ts");
assert.match(taxiApi, /assertProfileActive/);

const locationApi = readRepo("apps/web/src/lib/mmdLocationCore.ts");
assert.match(locationApi, /assertProfileActive/);

const aiAuth = readRepo("apps/web/src/lib/ai/requireAiApiUser.ts");
assert.match(aiAuth, /assertProfileActive/);

const chat = readRepo("apps/web/app/api/chat/messages/route.ts");
assert.match(chat, /resolveAuthorizedChatPushTarget/);
assert.match(chat, /assertProfileActive/);

const createCall = readRepo("apps/web/app/api/twilio/calls/create/route.ts");
assert.match(createCall, /toPublicMaskedCallSession/);
assert.doesNotMatch(createCall, /return NextResponse\.json\(\{\s*success: true,\s*session,/);

const incoming = readRepo("apps/web/src/lib/twilioVoiceIncoming.ts");
assert.match(incoming, /pickMaskedCallSession/);

const webhook = readRepo("apps/web/src/lib/paymentWebhookService.ts");
assert.match(webhook, /assertPaidAmountMatches/);

const agent = readRepo("apps/web/src/lib/ai/aiAgent.ts");
assert.match(agent, /sanitizeClientAiHistory/);
assert.doesNotMatch(agent, /turn\.role === "assistant"/);

const identity = readRepo("apps/web/app/api/identity/sessions/route.ts");
assert.match(identity, /assertSafeAppReturnUrl/);

const adminPages = readRepo("apps/web/src/lib/adminPageAuth.ts");
assert.match(adminPages, /isAccountActive/);
assert.match(adminPages, /account_status/);

const cashout = readRepo("apps/web/app/api/wallet/driver-cashout/route.ts");
assert.match(cashout, /assertProfileActive/);
assert.match(cashout, /wallet-cashout/);

const foodCheckout = readRepo(
  "apps/web/app/api/stripe/client/create-checkout-session/route.ts"
);
assert.match(foodCheckout, /assertProfileActive/);

const foodConfirm = readRepo("apps/web/app/api/stripe/client/confirm-paid/route.ts");
assert.match(foodConfirm, /assertProfileActive/);

const orderCancel = readRepo("apps/web/app/api/orders/cancel/route.ts");
assert.match(orderCancel, /assertProfileActive/);

const pushNotify = readRepo("apps/web/app/api/chat/push-notify/route.ts");
assert.match(pushNotify, /assertProfileActive/);

const callAction = readRepo("apps/web/app/api/twilio/calls/action/route.ts");
assert.match(callAction, /assertProfileActive/);

const selfie = readRepo("apps/web/app/api/driver/identity/checks/[checkId]/route.ts");
assert.match(selfie, /resolveIdentitySelfieContent/);

const safety = readRepo("apps/web/app/api/taxi/rides/safety-recording/upload/route.ts");
assert.match(safety, /resolveSafetyRecordingBytes/);

const mobileAuth = readRepo("apps/mobile/lib/supabase.ts");
assert.match(mobileAuth, /createSecureAuthStorage/);
assert.doesNotMatch(mobileAuth, /storage: AsyncStorage/);

console.log("securityHardening.regression.test.ts OK");
