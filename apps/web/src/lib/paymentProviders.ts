import type {
  ProviderInitiateInput,
  ProviderInitiateResult,
  ProviderStatusResult,
  ProviderWebhookResult,
} from "@/lib/paymentTypes";
import type { PaymentProvider } from "@/lib/paymentTypes";

export type PaymentProviderAdapter = {
  provider: PaymentProvider;
  initiate(input: ProviderInitiateInput): Promise<ProviderInitiateResult>;
  parseWebhook(body: unknown, headers: Headers): Promise<ProviderWebhookResult>;
  fetchStatus(externalReference: string, testMode: boolean): Promise<ProviderStatusResult>;
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function mapProviderStatus(raw: unknown): ProviderInitiateResult["status"] | "failed" {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "completed" || value === "success" || value === "paid") return "paid";
  if (value === "pending" || value === "initiated") return "processing";
  if (value === "cancelled" || value === "canceled") return "canceled";
  if (value === "expired") return "expired";
  if (value === "failed") return "failed";
  return "processing";
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

export const orangeMoneyGuineaAdapter: PaymentProviderAdapter = {
  provider: "orange_money_gn",
  async initiate(input) {
    const base = env("ORANGE_MONEY_GN_API_BASE") || "https://api.orange.com/orange-money-webpay/gn/v1";
    const merchantKey = env("ORANGE_MONEY_GN_MERCHANT_KEY");
    const reference = `mmd-${input.transactionId}`;

    const { ok, json } = await postJson(
      `${base.replace(/\/$/, "")}/webpayment`,
      {
        Authorization: `Bearer ${env("ORANGE_MONEY_GN_ACCESS_TOKEN")}`,
        "X-Merchant-Key": merchantKey,
      },
      {
        merchant_key: merchantKey,
        currency: input.currency,
        order_id: reference,
        amount: input.amountCents,
        return_url: input.returnUrl,
        cancel_url: input.returnUrl,
        notif_url: input.notifyUrl,
        lang: "fr",
        reference,
      }
    );

    if (!ok) {
      return { ok: false, error: String(json.message ?? json.error ?? "orange_money_init_failed") };
    }

    const paymentUrl = String(json.payment_url ?? json.pay_url ?? "").trim() || null;
    return {
      ok: true,
      externalReference: String(json.pay_token ?? json.transaction_id ?? reference),
      paymentUrl,
      status: paymentUrl ? "processing" : "pending",
      payload: json,
    };
  },
  async parseWebhook(body, headers) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const signature = headers.get("x-orange-signature") ?? headers.get("x-signature");
    const secret = env("ORANGE_MONEY_GN_WEBHOOK_SECRET");
    if (secret && !signature) {
      return { ok: false, error: "missing_signature" };
    }
    const status = mapProviderStatus(payload.status ?? payload.payment_status);
    const externalReference = String(
      payload.pay_token ?? payload.transaction_id ?? payload.order_id ?? ""
    ).trim();
    if (!externalReference) return { ok: false, error: "missing_external_reference" };
    return {
      ok: true,
      externalReference,
      externalEventId: String(payload.event_id ?? payload.id ?? `${externalReference}:${status}`),
      status,
      payload,
    };
  },
  async fetchStatus(externalReference) {
    const base = env("ORANGE_MONEY_GN_API_BASE") || "https://api.orange.com/orange-money-webpay/gn/v1";
    const res = await fetch(
      `${base.replace(/\/$/, "")}/transactionstatus/${encodeURIComponent(externalReference)}`,
      {
        headers: {
          Authorization: `Bearer ${env("ORANGE_MONEY_GN_ACCESS_TOKEN")}`,
          "X-Merchant-Key": env("ORANGE_MONEY_GN_MERCHANT_KEY"),
        },
      }
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(json.message ?? "orange_money_status_failed") };
    return {
      ok: true,
      externalReference,
      status: mapProviderStatus(json.status ?? json.payment_status),
      payload: json,
    };
  },
};

export const paydunyaAdapter: PaymentProviderAdapter = {
  provider: "paydunya",
  async initiate(input) {
    const reference = `mmd-${input.transactionId}`;
    const { ok, json } = await postJson(
      "https://app.paydunya.com/api/v1/checkout-invoice/create",
      {
        "PAYDUNYA-MASTER-KEY": env("PAYDUNYA_MASTER_KEY"),
        "PAYDUNYA-PRIVATE-KEY": env("PAYDUNYA_PRIVATE_KEY"),
        "PAYDUNYA-TOKEN": env("PAYDUNYA_TOKEN"),
      },
      {
        invoice: {
          total_amount: input.amountCents / 100,
          description: input.description,
        },
        store: {
          name: env("PAYDUNYA_STORE_NAME") || "MMD Delivery",
        },
        custom_data: {
          transaction_id: input.transactionId,
          method_code: input.methodCode,
        },
        actions: {
          callback_url: input.notifyUrl,
          return_url: input.returnUrl,
          cancel_url: input.returnUrl,
        },
      }
    );

    if (!ok) {
      return { ok: false, error: String(json.response_text ?? json.message ?? "paydunya_init_failed") };
    }

    const response = (json.response ?? json) as Record<string, unknown>;
    const token = String(response.token ?? json.token ?? reference).trim();
    const paymentUrl = String(response.response_text ?? response.checkout_url ?? json.url ?? "").trim();
    return {
      ok: true,
      externalReference: token,
      paymentUrl: paymentUrl || null,
      status: paymentUrl ? "processing" : "pending",
      payload: json as Record<string, unknown>,
    };
  },
  async parseWebhook(body) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const statusRaw = String(data.status ?? payload.status ?? "").toLowerCase();
    const status =
      statusRaw === "completed" ? "paid" : statusRaw === "cancelled" ? "canceled" : mapProviderStatus(statusRaw);
    const externalReference = String(data.token ?? data.invoice_token ?? payload.token ?? "").trim();
    if (!externalReference) return { ok: false, error: "missing_external_reference" };
    return {
      ok: true,
      externalReference,
      externalEventId: String(data.hash ?? payload.hash ?? `${externalReference}:${status}`),
      status,
      payload: payload as Record<string, unknown>,
    };
  },
  async fetchStatus(externalReference) {
    const { ok, json } = await postJson(
      "https://app.paydunya.com/api/v1/checkout-invoice/confirm",
      {
        "PAYDUNYA-MASTER-KEY": env("PAYDUNYA_MASTER_KEY"),
        "PAYDUNYA-PRIVATE-KEY": env("PAYDUNYA_PRIVATE_KEY"),
        "PAYDUNYA-TOKEN": env("PAYDUNYA_TOKEN"),
      },
      { token: externalReference }
    );
    if (!ok) return { ok: false, error: String(json.response_text ?? "paydunya_status_failed") };
    const statusRaw = String(json.status ?? "").toLowerCase();
    return {
      ok: true,
      externalReference,
      status: statusRaw === "completed" ? "paid" : mapProviderStatus(statusRaw),
      payload: json as Record<string, unknown>,
    };
  },
};

export const cinetpayAdapter: PaymentProviderAdapter = {
  provider: "cinetpay",
  async initiate(input) {
    const transactionId = `mmd-${input.transactionId}`;
    const { ok, json } = await postJson("https://api-checkout.cinetpay.com/v2/payment", {}, {
      apikey: env("CINETPAY_API_KEY"),
      site_id: env("CINETPAY_SITE_ID"),
      transaction_id: transactionId,
      amount: input.amountCents,
      currency: input.currency,
      description: input.description,
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      channels: "MOBILE_MONEY",
      metadata: input.transactionId,
      customer_phone_number: input.payerPhone ?? undefined,
    });

    if (!ok || json.code && String(json.code) !== "201") {
      return { ok: false, error: String(json.message ?? json.description ?? "cinetpay_init_failed") };
    }

    const data = (json.data ?? json) as Record<string, unknown>;
    const paymentUrl = String(data.payment_url ?? json.payment_url ?? "").trim() || null;
    return {
      ok: true,
      externalReference: transactionId,
      paymentUrl,
      status: paymentUrl ? "processing" : "pending",
      payload: json as Record<string, unknown>,
    };
  },
  async parseWebhook(body) {
    const payload = (body ?? {}) as Record<string, unknown>;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const externalReference = String(
      data.transaction_id ?? payload.transaction_id ?? data.cpm_trans_id ?? ""
    ).trim();
    if (!externalReference) return { ok: false, error: "missing_external_reference" };
    const statusRaw = String(data.status ?? payload.status ?? "").toLowerCase();
    const status =
      statusRaw === "accepted" || statusRaw === "completed"
        ? "paid"
        : statusRaw === "refused"
          ? "failed"
          : mapProviderStatus(statusRaw);
    return {
      ok: true,
      externalReference,
      externalEventId: String(data.cpm_trans_id ?? payload.cpm_trans_id ?? `${externalReference}:${status}`),
      status,
      payload: payload as Record<string, unknown>,
    };
  },
  async fetchStatus(externalReference) {
    const { ok, json } = await postJson("https://api-checkout.cinetpay.com/v2/payment/check", {}, {
      apikey: env("CINETPAY_API_KEY"),
      site_id: env("CINETPAY_SITE_ID"),
      transaction_id: externalReference,
    });
    if (!ok) return { ok: false, error: String(json.message ?? "cinetpay_status_failed") };
    const data = (json.data ?? json) as Record<string, unknown>;
    const statusRaw = String(data.status ?? json.status ?? "").toLowerCase();
    return {
      ok: true,
      externalReference,
      status:
        statusRaw === "accepted" || statusRaw === "completed" ? "paid" : mapProviderStatus(statusRaw),
      payload: json as Record<string, unknown>,
    };
  },
};

const ADAPTERS: Record<PaymentProvider, PaymentProviderAdapter> = {
  stripe: {
    provider: "stripe",
    async initiate() {
      return { ok: false, error: "stripe_uses_legacy_checkout_flow" };
    },
    async parseWebhook() {
      return { ok: false, error: "stripe_uses_dedicated_webhook_route" };
    },
    async fetchStatus() {
      return { ok: false, error: "stripe_uses_legacy_checkout_flow" };
    },
  },
  orange_money_gn: orangeMoneyGuineaAdapter,
  paydunya: paydunyaAdapter,
  cinetpay: cinetpayAdapter,
};

export function getPaymentProviderAdapter(provider: PaymentProvider): PaymentProviderAdapter {
  return ADAPTERS[provider];
}

export function parsePaymentProvider(value: unknown): PaymentProvider | null {
  const provider = String(value ?? "")
    .trim()
    .toLowerCase() as PaymentProvider;
  return provider in ADAPTERS ? provider : null;
}
