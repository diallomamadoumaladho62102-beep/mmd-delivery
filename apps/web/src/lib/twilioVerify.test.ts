import assert from "node:assert/strict";
import { isPhoneOtpEnabled } from "./twilioVerify";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("PHONE_OTP_ENABLED defaults off", () => {
  const prev = process.env.PHONE_OTP_ENABLED;
  delete process.env.PHONE_OTP_ENABLED;
  assert.equal(isPhoneOtpEnabled(), false);
  process.env.PHONE_OTP_ENABLED = "true";
  assert.equal(isPhoneOtpEnabled(), true);
  if (prev === undefined) delete process.env.PHONE_OTP_ENABLED;
  else process.env.PHONE_OTP_ENABLED = prev;
});

console.log("twilioVerify tests passed");
