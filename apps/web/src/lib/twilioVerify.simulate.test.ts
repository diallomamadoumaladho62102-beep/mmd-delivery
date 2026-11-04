import assert from "node:assert/strict";
import {
  PHONE_OTP_SIMULATE_CODE,
  checkPhoneVerification,
  isIsolatedOtpTestPhone,
  isPhoneOtpProductionRuntime,
  isPhoneOtpSimulate,
  resetPhoneOtpSimulateLedgerForTests,
  startPhoneVerification,
} from "./twilioVerify";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`ok ${name}`))
    .catch((e) => {
      console.error(`FAIL ${name}`);
      throw e;
    });
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const prevEnabled = env.PHONE_OTP_ENABLED;
  const prevSimulate = env.PHONE_OTP_SIMULATE;
  const prevNode = env.NODE_ENV;
  const prevVercel = env.VERCEL_ENV;
  env.PHONE_OTP_ENABLED = "true";
  env.PHONE_OTP_SIMULATE = "true";
  env.NODE_ENV = "test";
  delete env.VERCEL_ENV;
  resetPhoneOtpSimulateLedgerForTests();

  await test("simulate flag on", () => {
    assert.equal(isPhoneOtpSimulate(), true);
  });

  await test("simulate hard-disabled when NODE_ENV=production", () => {
    env.NODE_ENV = "production";
    assert.equal(isPhoneOtpProductionRuntime(), true);
    assert.equal(isPhoneOtpSimulate(), false);
    env.NODE_ENV = "test";
  });

  await test("simulate hard-disabled when VERCEL_ENV=production", () => {
    env.VERCEL_ENV = "production";
    env.NODE_ENV = "development";
    assert.equal(isPhoneOtpProductionRuntime(), true);
    assert.equal(isPhoneOtpSimulate(), false);
    delete env.VERCEL_ENV;
    env.NODE_ENV = "test";
  });

  await test("start rejects simulate path in production even if flag set", async () => {
    env.VERCEL_ENV = "production";
    const started = await startPhoneVerification({ phone: "+15551234567" });
    // Without Twilio creds in this unit test, real path returns unavailable — never simulated.
    assert.notEqual(started.simulated, true);
    delete env.VERCEL_ENV;
  });

  await test("only isolated phones", () => {
    assert.equal(isIsolatedOtpTestPhone("+15551234567"), true);
    assert.equal(isIsolatedOtpTestPhone("+224621009900"), true);
    assert.equal(isIsolatedOtpTestPhone("+19295550100"), false);
  });

  await test("rejects non-lab phone in simulate", async () => {
    const started = await startPhoneVerification({ phone: "+19295550100" });
    assert.equal(started.ok, false);
  });

  await test("start + wrong code + correct code + reuse", async () => {
    const phone = "+15551234567";
    const started = await startPhoneVerification({ phone });
    assert.equal(started.ok, true);
    assert.equal(started.simulated, true);

    const bad = await checkPhoneVerification({ phone, code: "111111" });
    assert.equal(bad.ok, false);

    const expired = await checkPhoneVerification({ phone, code: "000000" });
    assert.equal(expired.ok, false);

    // Restart after expired probe.
    await startPhoneVerification({ phone });
    const ok = await checkPhoneVerification({
      phone,
      code: PHONE_OTP_SIMULATE_CODE,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.simulated, true);

    const reuse = await checkPhoneVerification({
      phone,
      code: PHONE_OTP_SIMULATE_CODE,
    });
    assert.equal(reuse.ok, false);
  });

  if (prevEnabled === undefined) delete env.PHONE_OTP_ENABLED;
  else env.PHONE_OTP_ENABLED = prevEnabled;
  if (prevSimulate === undefined) delete env.PHONE_OTP_SIMULATE;
  else env.PHONE_OTP_SIMULATE = prevSimulate;
  if (prevNode === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = prevNode;
  if (prevVercel === undefined) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = prevVercel;

  console.log("twilioVerify.simulate tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
