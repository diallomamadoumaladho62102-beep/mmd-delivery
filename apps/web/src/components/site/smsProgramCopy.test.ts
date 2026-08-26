import assert from "node:assert/strict";
import {
  SMS_CONSENT_CHECKBOX_EN,
  SMS_CONSENT_CHECKBOX_FR,
  SMS_CONSENT_DEFAULT,
  SMS_PROGRAM_COPY,
  SMS_PROGRAM_SEO,
} from "./smsProgramCopy";

assert.equal(SMS_CONSENT_DEFAULT, false);
assert.match(SMS_CONSENT_CHECKBOX_EN, /I agree to receive automated informational and transactional text messages from MMD Delivery/);
assert.match(SMS_CONSENT_CHECKBOX_EN, /Message frequency varies/);
assert.match(SMS_CONSENT_CHECKBOX_EN, /Message and data rates may apply/);
assert.match(SMS_CONSENT_CHECKBOX_EN, /Consent is not a condition of purchase/);
assert.match(SMS_CONSENT_CHECKBOX_EN, /STOP/);
assert.match(SMS_CONSENT_CHECKBOX_EN, /HELP/);
assert.doesNotMatch(SMS_CONSENT_CHECKBOX_EN, /offer|promo|discount/i);

assert.match(SMS_CONSENT_CHECKBOX_FR, /J’accepte de recevoir/);
assert.match(SMS_PROGRAM_COPY.en.intro, /No account/);
assert.match(SMS_PROGRAM_COPY.fr.intro, /Aucun compte/);
assert.equal(SMS_PROGRAM_SEO.robots, "index,follow");

console.log("smsProgramCopy.test.ts — PASS");
