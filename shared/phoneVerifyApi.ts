/**
 * Shared Twilio Verify client for Web + Mobile.
 * Calls the same server endpoints:
 *   POST /api/auth/phone/start
 *   POST /api/auth/phone/check
 */

export type PhoneVerifyApiOk = {
  ok: true;
  phone_e164?: string;
  phone_verified_at?: string;
  status: number;
};

export type PhoneVerifyApiErr = {
  ok: false;
  error: string;
  code?: string;
  status: number;
};

export type PhoneVerifyApiResult = PhoneVerifyApiOk | PhoneVerifyApiErr;

function normalizeBaseUrl(apiBaseUrl: string): string {
  return String(apiBaseUrl ?? "").trim().replace(/\/+$/, "");
}

async function postPhoneVerify(params: {
  apiBaseUrl: string;
  accessToken: string;
  path: "/api/auth/phone/start" | "/api/auth/phone/check";
  body: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<PhoneVerifyApiResult> {
  const base = normalizeBaseUrl(params.apiBaseUrl);
  const token = String(params.accessToken ?? "").trim();
  if (!base) {
    return { ok: false, error: "API base URL missing", status: 0 };
  }
  if (!token) {
    return { ok: false, error: "Unauthorized", code: "unauthorized", status: 401 };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const res = await fetchFn(`${base}${params.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params.body),
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    code?: string;
    phone_e164?: string;
    phone_verified_at?: string;
  };

  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      error: String(json.error ?? "Request failed"),
      code: json.code ? String(json.code) : undefined,
      status: res.status,
    };
  }

  return {
    ok: true,
    phone_e164: json.phone_e164 ? String(json.phone_e164) : undefined,
    phone_verified_at: json.phone_verified_at
      ? String(json.phone_verified_at)
      : undefined,
    status: res.status,
  };
}

export async function startPhoneVerificationRequest(params: {
  apiBaseUrl: string;
  accessToken: string;
  phone: string;
  fetchImpl?: typeof fetch;
}): Promise<PhoneVerifyApiResult> {
  return postPhoneVerify({
    apiBaseUrl: params.apiBaseUrl,
    accessToken: params.accessToken,
    path: "/api/auth/phone/start",
    body: { phone: String(params.phone ?? "").trim() },
    fetchImpl: params.fetchImpl,
  });
}

export async function checkPhoneVerificationRequest(params: {
  apiBaseUrl: string;
  accessToken: string;
  phone: string;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<PhoneVerifyApiResult> {
  return postPhoneVerify({
    apiBaseUrl: params.apiBaseUrl,
    accessToken: params.accessToken,
    path: "/api/auth/phone/check",
    body: {
      phone: String(params.phone ?? "").trim(),
      code: String(params.code ?? "").trim(),
    },
    fetchImpl: params.fetchImpl,
  });
}
