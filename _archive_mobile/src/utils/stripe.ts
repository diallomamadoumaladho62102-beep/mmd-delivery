import { Alert, Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/apiBase";

/**
 * IMPORTANT PRODUCTION NOTE
 * -------------------------
 * Le frontend NE DOIT PAS être la source de vérité finale pour Stripe.
 * Le backend / webhook Stripe doit confirmer le paiement et mettre à jour la DB.
 *
 * Ici, on fait quand même une vérification côté client après fermeture de Checkout
 * pour améliorer l’UX et réduire les cas où l’état reste "processing".
 */

function extractSupabaseFunctionError(error: any): string {
  try {
    const body = error?.context?.body ?? error?.context ?? null;
    if (typeof body === "string" && body.trim()) return body;
    if (body) return JSON.stringify(body);
    return error?.message ?? "Erreur inconnue";
  } catch {
    return error?.message ?? "Erreur inconnue";
  }
}

function isExpoGo(): boolean {
  const ownership = (Constants as any)?.appOwnership;
  return ownership === "expo";
}

function pickOnboardingUrl(data: any): string | null {
  if (!data) return null;

  const url =
    data?.onboarding_url ??
    data?.onboardingUrl ??
    data?.url ??
    data?.link ??
    data?.data?.onboarding_url ??
    data?.data?.url;

  if (typeof url === "string" && url.trim().length > 0) return url.trim();
  return null;
}

function apiBase() {
  if (!API_BASE_URL) throw new Error("API_BASE_URL is missing");
  return API_BASE_URL.replace(/\/$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number) {
  return ms + Math.floor(Math.random() * 250);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const timeoutMs = init.timeoutMs ?? 15000;
  const AbortCtl: any = (globalThis as any).AbortController;

  if (!AbortCtl) {
    return fetch(input, init);
  }

  const controller = new AbortCtl();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const raw = await res.text().catch(() => "");

  if (!raw || !raw.trim()) {
    throw new Error("Empty response body");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || "Invalid JSON response");
  }
}

async function postJsonWithRetry<T>(
  url: string,
  token: string,
  body: unknown,
  opts?: { attempts?: number; timeoutMs?: number }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 2);
  const timeoutMs = opts?.timeoutMs ?? 15000;

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          txt || `HTTP ${res.status} ${res.statusText || ""}`.trim()
        );
      }

      return await parseJsonResponse<T>(res);
    } catch (error) {
      lastErr = error;

      if (attempt < attempts) {
        const backoffMs = jitter(700 * attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw lastErr ?? new Error("Request failed");
}

type CreateDeliveryCheckoutResponse = {
  url: string;
  session_id?: string;
  sessionId?: string;
  id?: string;
};

type MarkDeliveryPaidResponse = {
  ok: boolean;
  stripe_paid?: boolean;
  already?: boolean;
  delivery_request_id?: string;
  stripe_payment_intent_id?: string | null;
  payment_status?: string | null;
  status?: string | null;
  message?: string;
};

function pickCheckoutSessionId(
  data: CreateDeliveryCheckoutResponse | null | undefined
): string | null {
  if (!data) return null;

  const sessionId = data.session_id ?? data.sessionId ?? data.id ?? null;
  if (typeof sessionId === "string" && sessionId.trim()) {
    return sessionId.trim();
  }
  return null;
}

function isMarkPaidSuccess(res: MarkDeliveryPaidResponse | null | undefined) {
  if (!res) return false;
  if (res.ok && res.stripe_paid) return true;
  if (res.ok && res.already) return true;
  if (res.payment_status === "paid") return true;
  return false;
}

async function verifyDeliveryRequestPaid(params: {
  accessToken: string;
  deliveryRequestId: string;
  checkoutSessionId?: string | null;
  attempts?: number;
  delayMs?: number;
}): Promise<MarkDeliveryPaidResponse> {
  const {
    accessToken,
    deliveryRequestId,
    checkoutSessionId = null,
    attempts = 6,
    delayMs = 2000,
  } = params;

  const markPaidEndpoint = `${apiBase()}/api/stripe/mark-delivery-request-paid`;

  let lastError: unknown = null;
  let lastResponse: MarkDeliveryPaidResponse | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await postJsonWithRetry<MarkDeliveryPaidResponse>(
        markPaidEndpoint,
        accessToken,
        {
          deliveryRequestId,
          session_id: checkoutSessionId,
          checkout_session_id: checkoutSessionId,
        },
        { attempts: 1, timeoutMs: 12000 }
      );

      lastResponse = response;

      if (isMarkPaidSuccess(response)) {
        console.log("[payments] ✅ Delivery payment verified", {
          deliveryRequestId,
          checkoutSessionId,
          payment_status: response.payment_status,
          status: response.status,
          stripe_paid: response.stripe_paid,
          already: response.already,
        });
        return response;
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `[payments] verifyDeliveryRequestPaid retry ${i + 1}/${attempts} failed:`,
        (error as any)?.message ?? error
      );
    }

    if (i < attempts - 1) {
      await sleep(jitter(delayMs * (i + 1)));
    }
  }

  if (lastResponse) {
    throw new Error(
      lastResponse.message ||
        "Paiement non confirmé par le serveur après plusieurs vérifications."
    );
  }

  throw lastError ?? new Error("Impossible de confirmer le paiement.");
}

// ✅ Onboarding Stripe Connect (Driver / Restaurant)
export async function startStripeOnboarding(
  role: "driver" | "restaurant" = "driver"
) {
  try {
    const { data: s, error: sErr } = await supabase.auth.getSession();
    if (sErr) console.log("getSession error:", sErr);
    console.log("ACCESS_TOKEN:", s?.session?.access_token);
    console.log("USER_ID (session):", s?.session?.user?.id);

    const { data, error } = await supabase.functions.invoke(
      "create_connect_account",
      { body: { role } }
    );

    if (error) {
      console.log(
        "create_connect_account error FULL:",
        JSON.stringify(error, null, 2)
      );
      const msg = extractSupabaseFunctionError(error);
      Alert.alert("Erreur Stripe", msg);
      return;
    }

    const url = pickOnboardingUrl(data);

    if (!url) {
      console.log("create_connect_account success but no url. data =", data);
      Alert.alert(
        "Erreur",
        "Stripe URL manquante. (La function a répondu mais l’URL n’a pas été trouvée.)"
      );
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Erreur", "Impossible d’ouvrir le lien Stripe.");
      return;
    }

    await Linking.openURL(url);
  } catch (e: any) {
    console.log("startStripeOnboarding catch:", e);
    Alert.alert("Erreur", e?.message ?? "Erreur Stripe.");
  }
}

/**
 * ✅ Checkout client (PaymentSheet) — restaurants/orders
 * - Appelle l’Edge Function `create_payment_intent`
 * - Initialise PaymentSheet
 * - Présente PaymentSheet
 *
 * NOTE:
 * Le succès du PaymentSheet ne garantit pas à lui seul que la DB soit à jour.
 * Le webhook backend Stripe doit faire foi.
 */
export async function payOrderWithPaymentSheet(
  orderId: string
): Promise<boolean> {
  if (!orderId) throw new Error("orderId manquant.");

  if (Platform.OS === "ios" && isExpoGo()) {
    Alert.alert(
      "Paiement indisponible sur iPhone (Expo Go)",
      "Le paiement Stripe natif sera activé quand on fera un build iOS (Apple Developer / EAS). Pour l’instant, on continue le backend et les tests."
    );
    return false;
  }

  const { data, error } = await supabase.functions.invoke(
    "create_payment_intent",
    {
      body: {
        orderId,
        order_id: orderId,
      },
    }
  );

  if (error) {
    console.log(
      "create_payment_intent error FULL:",
      JSON.stringify(error, null, 2)
    );
    throw new Error(extractSupabaseFunctionError(error));
  }

  const clientSecret =
    (data as any)?.clientSecret ??
    (data as any)?.client_secret ??
    (data as any)?.payment_intent_client_secret;

  if (!clientSecret || typeof clientSecret !== "string") {
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

/**
 * ✅ Checkout web Stripe — delivery_requests
 *
 * SOLIDIFICATION APPORTÉE:
 * - on tente TOUJOURS la vérification backend après fermeture du navigateur
 * - on transmet session_id quand disponible
 * - retries plus robustes
 * - on ne laisse plus un faux "success" silencieux
 *
 * IMPORTANT:
 * Le backend / webhook Stripe doit rester la source de vérité finale.
 */
export async function startCheckoutForDeliveryRequest(
  deliveryRequestId: string,
  accessToken: string
): Promise<void> {
  if (!deliveryRequestId) {
    throw new Error("deliveryRequestId is required");
  }

  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const base = apiBase();
  const createEndpoint = `${base}/api/stripe/client/create-delivery-request-checkout-session`;

  const checkoutData = await postJsonWithRetry<CreateDeliveryCheckoutResponse>(
    createEndpoint,
    accessToken,
    { deliveryRequestId },
    { attempts: 2, timeoutMs: 15000 }
  );

  if (!checkoutData?.url || typeof checkoutData.url !== "string") {
    throw new Error("Missing Checkout URL");
  }

  const checkoutSessionId = pickCheckoutSessionId(checkoutData);

  let browserResult: WebBrowser.WebBrowserResult | null = null;
  let browserError: unknown = null;

  try {
    browserResult = await WebBrowser.openBrowserAsync(checkoutData.url);
    console.log("[payments] browser result:", browserResult);
  } catch (error) {
    browserError = error;
    console.warn(
      "[payments] browser open/close error:",
      (error as any)?.message ?? error
    );
  }

  /**
   * NE PAS retourner immédiatement sur "dismiss".
   * Sur mobile, un paiement réussi peut quand même revenir avec un état ressemblant
   * à une fermeture du navigateur.
   *
   * On tente donc toujours une vérification serveur, sauf éventuellement si
   * le backend nous confirme lui-même l'absence de paiement.
   */
  try {
    await verifyDeliveryRequestPaid({
      accessToken,
      deliveryRequestId,
      checkoutSessionId,
      attempts: 6,
      delayMs: 1800,
    });
    return;
  } catch (verifyError: any) {
    console.warn(
      "[payments] final verification failed:",
      verifyError?.message ?? verifyError
    );

    const browserType = (browserResult as any)?.type;

    if (browserType === "cancel") {
      throw new Error(
        "Paiement annulé ou non confirmé. Aucune confirmation reçue du serveur."
      );
    }

    if (browserError) {
      throw new Error(
        verifyError?.message ||
          (browserError as any)?.message ||
          "Le paiement n’a pas pu être confirmé."
      );
    }

    throw new Error(
      verifyError?.message ||
        "Le paiement a été initié, mais la confirmation serveur n’a pas abouti. Vérifie le webhook Stripe et l’endpoint mark-delivery-request-paid."
    );
  }
}