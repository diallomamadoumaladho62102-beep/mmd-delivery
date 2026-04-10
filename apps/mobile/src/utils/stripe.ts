import { Alert, Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/apiBase";

type JsonRecord = Record<string, unknown>;

type CheckoutInvokeResult = {
  fnName: string;
  data: JsonRecord | null;
};

type DeliveryPaymentRow = {
  id: string;
  payment_status: string | null;
  status: string | null;
  stripe_session_id: string | null;
};

type ConfirmDeliveryPaymentResponse = {
  ok?: boolean;
  already?: boolean;
  stripe_paid?: boolean;
  delivery_request_id?: string;
  error?: string;
};

type CheckoutStartResult = {
  ok: true;
  checkoutSessionId: string | null;
  deliveryRequestId: string;
  browserResultType: string | null;
};

const NETWORK_TIMEOUT_MS = 15000;
const CHECKOUT_POLL_ATTEMPTS = 20;
const CHECKOUT_POLL_INTERVAL_MS = 2000;
const CONFIRM_PAYMENT_ATTEMPTS = 3;
const CONFIRM_PAYMENT_RETRY_DELAY_MS = 1500;

function extractSupabaseFunctionError(error: unknown): string {
  try {
    const e = error as {
      message?: string;
      context?: { body?: unknown } | unknown;
    };

    const body =
      e?.context && typeof e.context === "object"
        ? (e.context as { body?: unknown })?.body ?? e.context
        : null;

    if (typeof body === "string" && body.trim()) return body.trim();
    if (body && typeof body === "object") return JSON.stringify(body);
    if (typeof e?.message === "string" && e.message.trim()) return e.message.trim();

    return "Erreur inconnue";
  } catch {
    return "Erreur inconnue";
  }
}

function isExpoGo(): boolean {
  const ownership = (Constants as { appOwnership?: string } | null)?.appOwnership;
  return ownership === "expo";
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizePaymentStatus(value: unknown): string | null {
  const s = asNonEmptyString(value);
  return s ? s.toLowerCase() : null;
}

function pickOnboardingUrl(data: unknown): string | null {
  const d = (data ?? {}) as any;

  return (
    asNonEmptyString(d?.onboarding_url) ??
    asNonEmptyString(d?.onboardingUrl) ??
    asNonEmptyString(d?.url) ??
    asNonEmptyString(d?.link) ??
    asNonEmptyString(d?.data?.onboarding_url) ??
    asNonEmptyString(d?.data?.onboardingUrl) ??
    asNonEmptyString(d?.data?.url) ??
    asNonEmptyString(d?.data?.link)
  );
}

function pickCheckoutUrl(data: unknown): string | null {
  const d = (data ?? {}) as any;

  return (
    asNonEmptyString(d?.checkout_url) ??
    asNonEmptyString(d?.checkoutUrl) ??
    asNonEmptyString(d?.url) ??
    asNonEmptyString(d?.link) ??
    asNonEmptyString(d?.hosted_checkout_url) ??
    asNonEmptyString(d?.hosted_url) ??
    asNonEmptyString(d?.session?.url) ??
    asNonEmptyString(d?.data?.checkout_url) ??
    asNonEmptyString(d?.data?.checkoutUrl) ??
    asNonEmptyString(d?.data?.url) ??
    asNonEmptyString(d?.data?.link) ??
    asNonEmptyString(d?.data?.session?.url)
  );
}

function pickCheckoutSessionId(data: unknown): string | null {
  const d = (data ?? {}) as any;

  return (
    asNonEmptyString(d?.checkoutSessionId) ??
    asNonEmptyString(d?.checkout_session_id) ??
    asNonEmptyString(d?.sessionId) ??
    asNonEmptyString(d?.session_id) ??
    asNonEmptyString(d?.id) ??
    asNonEmptyString(d?.session?.id) ??
    asNonEmptyString(d?.data?.checkoutSessionId) ??
    asNonEmptyString(d?.data?.checkout_session_id) ??
    asNonEmptyString(d?.data?.sessionId) ??
    asNonEmptyString(d?.data?.session_id) ??
    asNonEmptyString(d?.data?.id) ??
    asNonEmptyString(d?.data?.session?.id)
  );
}

function maskToken(token?: string | null): string | null {
  if (!token) return null;
  if (token.length <= 12) return "***";
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiBase(): string {
  const base = (API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("API_BASE_URL manquante.");
  }
  return base;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted") ||
      error.message.toLowerCase().includes("timeout"))
  );
}

async function postJsonWithRetry<T>(
  url: string,
  accessToken: string,
  body: JsonRecord,
  options?: { attempts?: number; timeoutMs?: number }
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  const timeoutMs = Math.max(3000, options?.timeoutMs ?? NETWORK_TIMEOUT_MS);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: unknown = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const parsed = (json ?? {}) as { error?: string; message?: string };
        const message =
          asNonEmptyString(parsed?.error) ??
          asNonEmptyString(parsed?.message) ??
          asNonEmptyString(text) ??
          `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;

        throw new Error(message);
      }

      return (json ?? {}) as T;
    } catch (error) {
      lastError = isAbortError(error)
        ? new Error(`Délai dépassé après ${timeoutMs} ms`)
        : error;

      if (attempt < attempts) {
        await sleep(500 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Échec de la requête réseau.");
}

async function invokeCheckoutFunction(
  deliveryRequestId: string,
  accessToken: string
): Promise<CheckoutInvokeResult> {
  const base = apiBase();

  const candidates = [
    `${base}/api/stripe/client/create-delivery-request-checkout-session`,
    `${base}/api/stripe/client/create-delivery-request-checkout`,
    `${base}/api/stripe/client/create-checkout-session`,
  ];

  const body: JsonRecord = {
    deliveryRequestId,
    delivery_request_id: deliveryRequestId,
    requestId: deliveryRequestId,
    request_id: deliveryRequestId,
  };

  let lastError: unknown = null;

  for (const url of candidates) {
    try {
      const data = await postJsonWithRetry<JsonRecord | null>(url, accessToken, body, {
        attempts: 2,
        timeoutMs: NETWORK_TIMEOUT_MS,
      });

      return { fnName: url, data };
    } catch (error) {
      lastError = error;
      console.log("[payments] invoke checkout route error:", {
        url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "Impossible de créer la session de paiement Stripe."
  );
}

async function confirmDeliveryRequestPaid(
  deliveryRequestId: string,
  accessToken: string
): Promise<ConfirmDeliveryPaymentResponse> {
  const base = apiBase();
  const url = `${base}/api/stripe/client/confirm-delivery-request-paid`;

  console.log("[payments] confirm delivery request paid →", url);

  return await postJsonWithRetry<ConfirmDeliveryPaymentResponse>(
    url,
    accessToken,
    {
      deliveryRequestId,
      delivery_request_id: deliveryRequestId,
    },
    {
      attempts: 2,
      timeoutMs: NETWORK_TIMEOUT_MS,
    }
  );
}

async function tryConfirmDeliveryRequestPaidWithRetry(
  deliveryRequestId: string,
  accessToken: string,
  attempts = CONFIRM_PAYMENT_ATTEMPTS
): Promise<ConfirmDeliveryPaymentResponse | null> {
  let lastResult: ConfirmDeliveryPaymentResponse | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log("[payments] confirm delivery request attempt:", {
        attempt,
        deliveryRequestId,
      });

      const result = await confirmDeliveryRequestPaid(
        deliveryRequestId,
        accessToken
      );

      lastResult = result;

      console.log("[payments] confirm delivery request result:", {
        attempt,
        result,
      });

      if (result?.ok && (result?.stripe_paid || result?.already)) {
        return result;
      }

      if (attempt < attempts) {
        await sleep(CONFIRM_PAYMENT_RETRY_DELAY_MS);
      }
    } catch (error) {
      console.log("[payments] confirm delivery request error:", {
        attempt,
        deliveryRequestId,
        message: error instanceof Error ? error.message : String(error),
      });

      if (attempt < attempts) {
        await sleep(CONFIRM_PAYMENT_RETRY_DELAY_MS);
      }
    }
  }

  return lastResult;
}

async function readDeliveryRequestPayment(
  deliveryRequestId: string
): Promise<DeliveryPaymentRow | null> {
  const { data, error } = await supabase
    .from("delivery_requests")
    .select("id, payment_status, status, stripe_session_id")
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (error) {
    console.log("[payments] read delivery request payment error:", error.message);
    return null;
  }

  return (data as DeliveryPaymentRow | null) ?? null;
}

async function pollDeliveryRequestPayment(
  deliveryRequestId: string,
  maxAttempts = CHECKOUT_POLL_ATTEMPTS,
  intervalMs = CHECKOUT_POLL_INTERVAL_MS
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await readDeliveryRequestPayment(deliveryRequestId);

    if (data) {
      const paymentStatus = normalizePaymentStatus(data.payment_status);
      const checkoutSessionId = data.stripe_session_id ?? null;

      console.log("[payments] poll delivery request:", {
        attempt: attempt + 1,
        payment_status: paymentStatus,
        status: data.status,
        stripe_session_id: checkoutSessionId,
      });

      if (paymentStatus === "paid") {
        console.log("[payments] ✅ Delivery payment verified", {
          deliveryRequestId,
          payment_status: paymentStatus,
          stripe_session_id: checkoutSessionId,
          verifiedAfterAttempt: attempt + 1,
        });
        return true;
      }
    }

    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }

  return false;
}

async function canOpenHttpUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const canOpen = await Linking.canOpenURL(url);
    return typeof canOpen === "boolean" ? canOpen : true;
  } catch {
    return true;
  }
}

async function openExternalUrl(url: string): Promise<{ type: string | null }> {
  if (!(await canOpenHttpUrl(url))) {
    throw new Error("Impossible d’ouvrir l’URL externe.");
  }

  try {
    if (Platform.OS === "android") {
      await WebBrowser.warmUpAsync();
    }

    const result = await WebBrowser.openBrowserAsync(url, {
      showTitle: true,
      enableDefaultShareMenuItem: false,
    });

    return { type: typeof result?.type === "string" ? result.type : null };
  } finally {
    try {
      if (Platform.OS === "android") {
        await WebBrowser.coolDownAsync();
      }
    } catch {
      // no-op
    }
  }
}

export async function startStripeOnboarding(
  role: "driver" | "restaurant" = "driver"
): Promise<boolean> {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.log("[stripe-onboarding] getSession error:", sessionError.message);
    }

    console.log("[stripe-onboarding] session:", {
      userId: sessionData?.session?.user?.id ?? null,
      hasAccessToken: Boolean(sessionData?.session?.access_token),
    });

    const { data, error } = await supabase.functions.invoke("create_connect_account", {
      body: { role },
    });

    if (error) {
      console.log(
        "[stripe-onboarding] create_connect_account error:",
        JSON.stringify(error, null, 2)
      );
      Alert.alert("Erreur Stripe", extractSupabaseFunctionError(error));
      return false;
    }

    const url = pickOnboardingUrl(data);

    if (!url) {
      console.log("[stripe-onboarding] no onboarding url in response:", data);
      Alert.alert(
        "Erreur",
        "Stripe URL manquante. La fonction a répondu, mais aucune URL d’onboarding n’a été trouvée."
      );
      return false;
    }

    await openExternalUrl(url);
    return true;
  } catch (error) {
    console.log("[stripe-onboarding] catch:", error);
    Alert.alert(
      "Erreur",
      error instanceof Error ? error.message : "Erreur Stripe."
    );
    return false;
  }
}

export async function payOrderWithPaymentSheet(orderId: string): Promise<boolean> {
  const normalizedOrderId = orderId?.trim();

  if (!normalizedOrderId) {
    throw new Error("orderId manquant.");
  }

  if (Platform.OS === "ios" && isExpoGo()) {
    Alert.alert(
      "Paiement indisponible sur iPhone (Expo Go)",
      "Le paiement Stripe natif nécessite un development build ou un vrai build iOS. Expo Go ne suffit pas pour un test réel."
    );
    return false;
  }

  const { data, error } = await supabase.functions.invoke("create_payment_intent", {
    body: {
      orderId: normalizedOrderId,
      order_id: normalizedOrderId,
    },
  });

  if (error) {
    console.log(
      "[payments] create_payment_intent error:",
      JSON.stringify(error, null, 2)
    );
    throw new Error(extractSupabaseFunctionError(error));
  }

  const d = (data ?? {}) as any;
  const clientSecret =
    asNonEmptyString(d?.clientSecret) ??
    asNonEmptyString(d?.client_secret) ??
    asNonEmptyString(d?.payment_intent_client_secret);

  if (!clientSecret) {
    throw new Error("clientSecret manquant depuis create_payment_intent.");
  }

  const stripeNative = await import("@stripe/stripe-react-native");
  const initPaymentSheet = stripeNative.initPaymentSheet;
  const presentPaymentSheet = stripeNative.presentPaymentSheet;

  const init = await initPaymentSheet({
    merchantDisplayName: "MMD Delivery",
    paymentIntentClientSecret: clientSecret,
    allowsDelayedPaymentMethods: true,
  });

  if (init.error) {
    throw new Error(init.error.message);
  }

  const present = await presentPaymentSheet();

  if (present.error) {
    if (present.error.code === "Canceled") {
      throw new Error("Paiement annulé.");
    }
    throw new Error(present.error.message);
  }

  return true;
}

export async function startCheckoutForDeliveryRequest(
  deliveryRequestId: string,
  accessToken: string
): Promise<CheckoutStartResult> {
  const normalizedDeliveryRequestId = deliveryRequestId?.trim();
  const normalizedAccessToken = accessToken?.trim();

  if (!normalizedDeliveryRequestId) {
    throw new Error("deliveryRequestId manquant.");
  }

  if (!normalizedAccessToken) {
    throw new Error("accessToken manquant.");
  }

  console.log("[payments] start checkout:", {
    deliveryRequestId: normalizedDeliveryRequestId,
    accessToken: maskToken(normalizedAccessToken),
  });

  const { fnName, data } = await invokeCheckoutFunction(
    normalizedDeliveryRequestId,
    normalizedAccessToken
  );

  console.log("[payments] checkout function used:", fnName);

  const checkoutUrl = pickCheckoutUrl(data);
  const checkoutSessionId = pickCheckoutSessionId(data);

  if (!checkoutUrl) {
    console.log("[payments] checkout response without url:", data);
    throw new Error("URL Stripe Checkout manquante.");
  }

  const preCheck = await readDeliveryRequestPayment(normalizedDeliveryRequestId);
  if (preCheck && normalizePaymentStatus(preCheck.payment_status) === "paid") {
    return {
      ok: true,
      checkoutSessionId: checkoutSessionId ?? preCheck.stripe_session_id,
      deliveryRequestId: normalizedDeliveryRequestId,
      browserResultType: "already_paid",
    };
  }

  const browserResult = await openExternalUrl(checkoutUrl);
  console.log("[payments] browser result:", browserResult);

  const confirmResult = await tryConfirmDeliveryRequestPaidWithRetry(
    normalizedDeliveryRequestId,
    normalizedAccessToken,
    CONFIRM_PAYMENT_ATTEMPTS
  );

  if (confirmResult?.ok && (confirmResult?.stripe_paid || confirmResult?.already)) {
    console.log("[payments] ✅ Delivery confirm-paid API verified", {
      deliveryRequestId: normalizedDeliveryRequestId,
      confirmResult,
    });

    return {
      ok: true,
      checkoutSessionId,
      deliveryRequestId: normalizedDeliveryRequestId,
      browserResultType: browserResult.type,
    };
  }

  const paid = await pollDeliveryRequestPayment(
    normalizedDeliveryRequestId,
    CHECKOUT_POLL_ATTEMPTS,
    CHECKOUT_POLL_INTERVAL_MS
  );

  if (!paid) {
    console.log("[payments] payment not yet confirmed", {
      browserResultType: browserResult.type,
      checkoutSessionId,
      deliveryRequestId: normalizedDeliveryRequestId,
      confirmResult,
    });

    throw new Error(
      browserResult.type === "cancel"
        ? "Le navigateur a été fermé ou le retour app n’a pas été capté. Si tu as payé, attends quelques secondes puis recharge la demande."
        : "Paiement non confirmé pour le moment. Si tu as payé, attends quelques secondes puis réessaie."
    );
  }

  return {
    ok: true,
    checkoutSessionId,
    deliveryRequestId: normalizedDeliveryRequestId,
    browserResultType: browserResult.type,
  };
}