import {
  checkPhoneVerificationRequest,
  startPhoneVerificationRequest,
} from "./phoneVerifyApi.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const fetchStart = (async () =>
    new Response(JSON.stringify({ ok: true, phone_e164: "+15551234567" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

  const started = await startPhoneVerificationRequest({
    apiBaseUrl: "https://example.com",
    accessToken: "tok",
    phone: "+15551234567",
    fetchImpl: fetchStart,
  });
  assert(started.ok === true, "start ok");
  assert(started.ok && started.phone_e164 === "+15551234567", "e164");

  const fetchFail = (async () =>
    new Response(
      JSON.stringify({ ok: false, error: "Phone OTP is not enabled", code: "phone_otp_disabled" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;

  const disabled = await startPhoneVerificationRequest({
    apiBaseUrl: "https://example.com/",
    accessToken: "tok",
    phone: "+15551234567",
    fetchImpl: fetchFail,
  });
  assert(disabled.ok === false, "disabled fail");
  assert(!disabled.ok && disabled.status === 403, "403");
  assert(!disabled.ok && disabled.code === "phone_otp_disabled", "code");

  const noToken = await checkPhoneVerificationRequest({
    apiBaseUrl: "https://example.com",
    accessToken: "",
    phone: "+15551234567",
    code: "123456",
  });
  assert(noToken.ok === false && noToken.status === 401, "unauthorized");

  console.log("phoneVerifyApi tests passed");
}

void main();
