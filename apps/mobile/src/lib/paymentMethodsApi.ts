import { getApiBaseUrl } from "../../lib/apiBase";

export type PaymentMethodOption = {
  method_code: string;
  provider: string;
  display_name: string;
  description: string | null;
  test_mode: boolean;
  available: boolean;
  unavailable_reason: string | null;
  sort_order: number;
};

export type PaymentMethodsResponse = {
  ok: boolean;
  country_code?: string;
  methods?: PaymentMethodOption[];
  local_methods?: PaymentMethodOption[];
  stripe_methods?: PaymentMethodOption[];
  prefer_local_mobile_money?: boolean;
  error?: string;
};

export type InitiatePaymentResponse = {
  ok: boolean;
  payment_id?: string;
  status?: string;
  payment_url?: string | null;
  provider?: string;
  method_code?: string;
  message?: string;
  error?: string;
};

export type PaymentStatusResponse = {
  ok: boolean;
  payment_id?: string;
  status?: string;
  provider?: string;
  method_code?: string;
  amount_cents?: number;
  currency?: string;
  paid_at?: string | null;
  failure_reason?: string | null;
  error?: string;
};

const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "US",
  CAD: "CA",
  GBP: "GB",
  EUR: "FR",
  GNF: "GN",
  XOF: "SN",
  SLE: "SL",
  MRU: "MR",
};

export function inferCountryCode(input?: {
  countryCode?: string | null;
  currency?: string | null;
}): string {
  const explicit = String(input?.countryCode ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (explicit.length === 2) return explicit;
  const currency = String(input?.currency ?? "")
    .trim()
    .toUpperCase();
  return CURRENCY_COUNTRY[currency] ?? "US";
}

export function prefersLocalMobileMoney(countryCode: string): boolean {
  return ["GN", "SN", "CI"].includes(countryCode.toUpperCase());
}

async function authFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const raw = await res.text();
  let json: T;
  try {
    json = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new Error(raw || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const message =
      (json as { message?: string; error?: string }).message ??
      (json as { error?: string }).error ??
      raw;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchPaymentMethods(
  accessToken: string,
  params: { countryCode: string; entityType?: string }
): Promise<PaymentMethodsResponse> {
  const query = new URLSearchParams({
    country_code: params.countryCode,
  });
  if (params.entityType) query.set("entity_type", params.entityType);
  return authFetch<PaymentMethodsResponse>(
    `/api/payments/methods?${query.toString()}`,
    accessToken
  );
}

export async function initiateLocalPayment(
  accessToken: string,
  body: {
    entity_type: string;
    entity_id: string;
    method_code: string;
    country_code?: string;
    payer_phone?: string;
  }
): Promise<InitiatePaymentResponse> {
  return authFetch<InitiatePaymentResponse>("/api/payments/initiate", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchPaymentStatus(
  accessToken: string,
  paymentId: string
): Promise<PaymentStatusResponse> {
  return authFetch<PaymentStatusResponse>(
    `/api/payments/status/${encodeURIComponent(paymentId)}`,
    accessToken
  );
}

export async function pollPaymentUntilTerminal(
  accessToken: string,
  paymentId: string,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<PaymentStatusResponse> {
  const timeoutMs = opts?.timeoutMs ?? 120000;
  const intervalMs = opts?.intervalMs ?? 2500;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const status = await fetchPaymentStatus(accessToken, paymentId);
    const value = String(status.status ?? "").toLowerCase();
    if (value === "paid" || value === "failed" || value === "canceled" || value === "expired") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return fetchPaymentStatus(accessToken, paymentId);
}
