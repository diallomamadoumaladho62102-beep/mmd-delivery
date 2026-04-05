import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "./apiBase";

type CreateCheckoutResponse = {
  url: string;
  session_id?: string;
  id?: string;
};

type ConfirmPaidResponse = {
  ok: boolean;
  stripe_paid?: boolean;
  already?: boolean;
  order_id?: string;
};

function apiBase() {
  if (!API_BASE_URL) throw new Error("API_BASE_URL is missing");
  return API_BASE_URL.replace(/\/$/, "");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// RN/Expo: selon runtime, AbortController peut ne pas être pleinement supporté.
// -> On fait best-effort: si AbortController existe, on l’utilise, sinon fallback.
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
  const t: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function postJsonWithRetry<T>(
  url: string,
  token: string,
  body: any,
  opts?: { attempts?: number; timeoutMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 15000;

  let lastErr: any = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status} ${res.statusText || ""}`.trim());
      }

      const raw = await res.text().catch(() => "");
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new Error(raw || "Invalid JSON response");
      }
    } catch (e: any) {
      lastErr = e;

      if (i < attempts) await sleep(800 * i);
    }
  }

  throw lastErr ?? new Error("Request failed");
}

/**
 * ✅ Paiement Stripe robuste:
 * - Crée une session checkout (retry + timeout)
 * - Ouvre Stripe
 * - Au retour, appelle confirm-paid (même si webhook rate)
 */
export async function startCheckoutForOrder(orderId: string, accessToken: string): Promise<void> {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken) throw new Error("accessToken is required");

  const base = apiBase();
  const createEndpoint = `${base}/api/stripe/client/create-checkout-session`;
  const confirmEndpoint = `${base}/api/stripe/client/confirm-paid`;

  const data = await postJsonWithRetry<CreateCheckoutResponse>(
    createEndpoint,
    accessToken,
    { orderId },
    { attempts: 2, timeoutMs: 15000 }
  );

  if (!data?.url) throw new Error("Missing Checkout URL");

  const result = await WebBrowser.openBrowserAsync(data.url);

  const didCancel =
    (result as any)?.type === "cancel" || (result as any)?.type === "dismiss";

  if (didCancel) {
    return;
  }

  try {
    await postJsonWithRetry<ConfirmPaidResponse>(
      confirmEndpoint,
      accessToken,
      { orderId },
      { attempts: 2, timeoutMs: 12000 }
    );
  } catch (e) {
    console.warn("[payments] confirm-paid failed:", (e as any)?.message ?? e);
  }
}