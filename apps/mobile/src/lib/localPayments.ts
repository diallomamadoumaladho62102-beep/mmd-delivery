import * as WebBrowser from "expo-web-browser";
import {
  fetchPaymentMethods,
  initiateLocalPayment,
  pollPaymentUntilTerminal,
  prefersLocalMobileMoney,
  type PaymentMethodOption,
} from "./paymentMethodsApi";

export type LocalPaymentEntity = {
  entityType: "order" | "delivery_request" | "taxi_ride" | "seller_order";
  entityId: string;
  countryCode: string;
};

export async function loadLocalPaymentMethods(
  accessToken: string,
  params: LocalPaymentEntity
): Promise<PaymentMethodOption[]> {
  try {
    const response = await fetchPaymentMethods(accessToken, {
      countryCode: params.countryCode,
      entityType: params.entityType,
    });
    if (!response.ok) return [];
    const methods = response.local_methods ?? response.methods ?? [];
    return methods.filter((method) => method.provider !== "stripe");
  } catch {
    return [];
  }
}

export async function startLocalPaymentForMethod(
  accessToken: string,
  params: LocalPaymentEntity & { methodCode: string; payerPhone?: string }
): Promise<{ ok: boolean; paid?: boolean; error?: string }> {
  const initiated = await initiateLocalPayment(accessToken, {
    entity_type: params.entityType,
    entity_id: params.entityId,
    method_code: params.methodCode,
    country_code: params.countryCode,
    payer_phone: params.payerPhone,
  });

  if (!initiated.ok) {
    return {
      ok: false,
      error:
        initiated.message ??
        initiated.error ??
        "Payment method temporarily unavailable",
    };
  }

  if (!initiated.payment_id) {
    return { ok: false, error: "Missing payment reference" };
  }

  if (initiated.payment_url) {
    await WebBrowser.openBrowserAsync(initiated.payment_url);
  }

  const finalStatus = await pollPaymentUntilTerminal(accessToken, initiated.payment_id);
  if (String(finalStatus.status ?? "").toLowerCase() === "paid") {
    return { ok: true, paid: true };
  }

  return {
    ok: false,
    error:
      finalStatus.failure_reason ??
      finalStatus.error ??
      "Payment was not confirmed yet. Pull to refresh in a few seconds.",
  };
}

export function shouldOfferLocalMobileMoney(countryCode: string): boolean {
  return prefersLocalMobileMoney(countryCode);
}

export function pickDefaultLocalMethod(
  methods: PaymentMethodOption[]
): PaymentMethodOption | null {
  const sorted = [...methods].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.find((method) => method.available) ?? sorted[0] ?? null;
}
