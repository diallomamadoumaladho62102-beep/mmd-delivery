import { getApiBaseUrl } from "../../lib/apiBase";

export type WalletAccountType = "driver" | "restaurant" | "seller" | "partner" | "client";

export type WalletSummaryResponse = {
  ok: boolean;
  account_type?: WalletAccountType;
  country_code?: string;
  currency?: string;
  balance_cents?: number;
  available_cents?: number;
  pending_cents?: number;
  minimum_payout_cents?: number;
  cashout_blocked_today?: boolean;
  last_cashout_at?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarded?: boolean;
  can_cashout?: boolean;
  cashout_block_reason?: string | null;
  error?: string;
};

export type WalletLedgerEntry = {
  id: string;
  account_type: WalletAccountType;
  country_code: string;
  currency: string;
  direction: "credit" | "debit";
  amount_cents: number;
  balance_after_cents: number | null;
  reference_type: string;
  reference_id: string;
  description: string | null;
  created_at: string;
};

export type WalletHistoryResponse = {
  ok: boolean;
  account_type?: WalletAccountType;
  items?: WalletLedgerEntry[];
  error?: string;
};

export type PayoutMethodOption = {
  method_code: string;
  provider: string;
  display_name: string;
  description: string | null;
  test_mode: boolean;
  auto_payout_enabled: boolean;
  payout_frequency: string;
  minimum_payout_cents: number;
  available: boolean;
  unavailable_reason: string | null;
  sort_order: number;
};

export type PayoutMethodsResponse = {
  ok: boolean;
  country_code?: string;
  recipient_type?: string;
  methods?: PayoutMethodOption[];
  error?: string;
};

export type PayoutTransactionItem = {
  id: string;
  country_code: string;
  recipient_type: string;
  provider: string;
  method_code: string;
  amount_cents: number;
  currency: string;
  status: string;
  payout_mode: string;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
};

export type PayoutTransactionsResponse = {
  ok: boolean;
  items?: PayoutTransactionItem[];
  error?: string;
};

export type DriverWalletSnapshot = {
  summary: WalletSummaryResponse;
  history: WalletHistoryResponse;
  payoutMethods: PayoutMethodsResponse;
  payoutTransactions: PayoutTransactionsResponse;
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

export function formatWalletAmount(cents: number, currency = "USD"): string {
  const value = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "GNF" || currency === "XOF" ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
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

export async function fetchWalletSummary(
  accessToken: string,
  params: {
    accountType: WalletAccountType;
    countryCode?: string;
    currency?: string;
  }
): Promise<WalletSummaryResponse> {
  const query = new URLSearchParams({
    account_type: params.accountType,
    country_code: inferCountryCode({ countryCode: params.countryCode, currency: params.currency }),
  });
  if (params.currency) query.set("currency", params.currency);
  return authFetch<WalletSummaryResponse>(`/api/wallet/summary?${query.toString()}`, accessToken);
}

export async function fetchWalletHistory(
  accessToken: string,
  params: { accountType: WalletAccountType; limit?: number }
): Promise<WalletHistoryResponse> {
  const query = new URLSearchParams({ account_type: params.accountType });
  if (params.limit) query.set("limit", String(params.limit));
  return authFetch<WalletHistoryResponse>(`/api/wallet/history?${query.toString()}`, accessToken);
}

export async function fetchPayoutMethods(
  accessToken: string,
  params: { countryCode: string; recipientType: "driver" | "restaurant" | "seller" | "partner" }
): Promise<PayoutMethodsResponse> {
  const query = new URLSearchParams({
    country_code: params.countryCode,
    recipient_type: params.recipientType,
  });
  return authFetch<PayoutMethodsResponse>(`/api/payouts/methods?${query.toString()}`, accessToken);
}

export async function fetchPayoutTransactions(
  accessToken: string,
  limit = 50
): Promise<PayoutTransactionsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return authFetch<PayoutTransactionsResponse>(
    `/api/payouts/transactions?${query.toString()}`,
    accessToken
  );
}

export async function fetchDriverWalletSnapshot(
  accessToken: string,
  params?: { countryCode?: string; currency?: string }
): Promise<DriverWalletSnapshot> {
  const countryCode = inferCountryCode(params);
  const [summary, history, payoutMethods, payoutTransactions] = await Promise.all([
    fetchWalletSummary(accessToken, { accountType: "driver", countryCode, currency: params?.currency }),
    fetchWalletHistory(accessToken, { accountType: "driver", limit: 20 }),
    fetchPayoutMethods(accessToken, { countryCode, recipientType: "driver" }),
    fetchPayoutTransactions(accessToken, 20),
  ]);

  if (!summary.ok) {
    throw new Error(summary.error ?? "wallet_summary_failed");
  }

  return { summary, history, payoutMethods, payoutTransactions };
}
