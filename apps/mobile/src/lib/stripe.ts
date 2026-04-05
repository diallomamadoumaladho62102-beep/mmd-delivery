// apps/mobile/src/lib/stripe.ts
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

/**
 * EXISTANT: Onboarding Stripe Connect pour chauffeur (ne touche pas)
 */
export async function configureDriverPayments(userId: string) {
  const return_url = "https://example.com/stripe-return";
  const refresh_url = "https://example.com/stripe-refresh";

  const { data, error } = await supabase.functions.invoke(
    "stripe_driver_onboarding",
    {
      body: { user_id: userId, return_url, refresh_url },
    }
  );

  if (error) {
    console.error("Stripe onboarding error:", error);
    throw error;
  }

  await WebBrowser.openBrowserAsync(data.url);
}

/**
 * ✅ PRO: "Check" (optionnel) d'une session Stripe côté serveur.
 *
 * IMPORTANT:
 * - Ta Edge Function confirm_checkout_session renvoie 500 car elle essaye d'UPDATE orders
 *   avec le token utilisateur => bloqué par ton trigger (Client can only update tip_cents).
 * - La vérité doit venir du webhook Stripe (service role) => orders.payment_status='paid'
 * - Côté app: on fait le polling DB (ClientOrderDetailsScreen.tsx: pollUntilPaid)
 *
 * Donc ici: on garde la fonction pour compat, mais on la désactive (no-op).
 */
export async function checkCheckoutSession(params: {
  orderId: string;
  sessionId: string;
}) {
  const { orderId, sessionId } = params;

  // ✅ On garde les logs utiles (debug), sans appeler la function qui casse
  if (!orderId || !sessionId) {
    return {
      ok: false,
      paid: false,
      reason: "missing_params",
    } as const;
  }

  // ✅ No-op: le polling DB suffit (et évite le 500 tip_cents)
  return {
    ok: false,
    paid: false,
    reason: "disabled_use_db_polling",
  } as const;
}

/**
 * ✅ PRO: Ouvre Stripe Checkout.
 * - On ouvre le checkout
 * - Au retour: on ne fait PLUS le check réseau (qui casse)
 * - La confirmation vient du polling orders.payment_status (DB)
 */
export async function openStripeCheckout(params: {
  checkoutUrl: string;
  orderId: string;
  sessionId: string;
}) {
  const { checkoutUrl, orderId, sessionId } = params;

  // 1) Ouvre Stripe Checkout
  await WebBrowser.openBrowserAsync(checkoutUrl);

  // 2) Au retour: on évite confirm_checkout_session (500 tip_cents)
  // L'écran fera pollUntilPaid() + refetch order.
  return {
    ok: true,
    paid: false,
    orderId,
    sessionId,
    skipped_check: true,
  } as const;
}
