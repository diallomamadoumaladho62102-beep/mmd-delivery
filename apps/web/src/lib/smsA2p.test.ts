import assert from "node:assert/strict";
import {
  canSendUsA2pSms,
  isSmsA2pApproved,
  isTransactionalSmsEnabled,
  MMD_A2P_MESSAGING_SERVICE_SID,
  MMD_SMS_CTA_URL,
} from "./smsA2p";
import { isMarketingSmsType } from "./smsOutbound";
import { assertExplicitConsentChecked } from "./smsConsent";
import { SMS_CONSENT_DEFAULT } from "@/components/site/smsProgramCopy";
import { A2P_MESSAGE_FLOW, A2P_SAMPLE_MESSAGE_LIST } from "./smsA2pCampaign";

function withEnv(name: string, value: string | undefined, fn: () => void) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

assert.equal(SMS_CONSENT_DEFAULT, false);
assert.equal(assertExplicitConsentChecked(false), false);
assert.equal(assertExplicitConsentChecked(undefined), false);
assert.equal(assertExplicitConsentChecked("true"), false);
assert.equal(assertExplicitConsentChecked(true), true);

assert.equal(isMarketingSmsType("marketing"), true);
assert.equal(isMarketingSmsType("order_dispatched"), false);

assert.equal(isSmsA2pApproved(), false);
assert.equal(isTransactionalSmsEnabled(), false);
assert.equal(canSendUsA2pSms().ok, false);

withEnv("TRANSACTIONAL_SMS_ENABLED", "true", () => {
  withEnv("SMS_A2P_10DLC_US_DONE", undefined, () => {
    const result = canSendUsA2pSms();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "a2p_not_approved");
  });
});

assert.equal(MMD_A2P_MESSAGING_SERVICE_SID, "MG8ef96bdce31bc5b2a8e21c3ebcbd4f12");
assert.equal(MMD_SMS_CTA_URL, "https://www.mmddelivery.com/legal/sms");
assert.match(A2P_MESSAGE_FLOW, /legal\/sms/);
assert.match(A2P_MESSAGE_FLOW, /unchecked/);
assert.match(A2P_MESSAGE_FLOW, /not treat account creation/);
assert.equal(A2P_SAMPLE_MESSAGE_LIST.length >= 4, true);

console.log("smsA2p.test.ts — PASS");
