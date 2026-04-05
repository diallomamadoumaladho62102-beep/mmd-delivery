import { Alert, Platform } from "react-native";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";

/**
 * Petit helper pour afficher le vrai message d’erreur renvoyé par une Edge Function.
 */
function extractSupabaseFunctionError(error: any): string {
  try {
    const body = error?.context?.body ?? error?.context ?? null;
    if (typeof body === "string") return body;
    if (body) return JSON.stringify(body);
    return error?.message ?? "Erreur inconnue";
  } catch {
    return error?.message ?? "Erreur inconnue";
  }
}

/**
 * Détecte si on est dans Expo Go.
 * (Expo Go => pas de modules natifs Stripe => crash iOS)
 */
function isExpoGo(): boolean {
  // expo-constants: appOwnership = "expo" quand on est dans Expo Go
  const ownership = (Constants as any)?.appOwnership;
  return ownership === "expo";
}

/**
 * Essaie de récupérer l'URL d'onboarding depuis différentes clés possibles.
 * (Car la function peut renvoyer onboarding_url / url / link, etc.)
 */
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

// ✅ Onboarding Stripe Connect (Driver / Restaurant)
export async function startStripeOnboarding(
  role: "driver" | "restaurant" = "driver"
) {
  try {
    // ✅ 1) Afficher le vrai token de session (pour tester avec curl)
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

    // ✅ FIX: ta function renvoie "onboarding_url" (pas "url")
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
 * ✅ Checkout client (PaymentSheet)
 * - Appelle l’Edge Function `create_payment_intent`
 * - Initialise PaymentSheet
 * - Présente PaymentSheet
 *
 * ⚠️ IMPORTANT:
 * Expo Go iOS ne supporte PAS @stripe/stripe-react-native (OnrampSdk manquant)
 * => donc on bloque proprement pour éviter le crash.
 */
export async function payOrderWithPaymentSheet(orderId: string) {
  if (!orderId) throw new Error("orderId manquant.");

  // ✅ Bloquer proprement sur iOS Expo Go (évite OnrampSdk crash)
  if (Platform.OS === "ios" && isExpoGo()) {
    Alert.alert(
      "Paiement indisponible sur iPhone (Expo Go)",
      "Le paiement Stripe natif sera activé quand on fera un build iOS (Apple Developer / EAS). Pour l’instant, on continue le backend et les tests."
    );
    return false;
  }

  // 1) Créer / récupérer PaymentIntent (secure backend)
  const { data, error } = await supabase.functions.invoke(
    "create_payment_intent",
    {
      body: {
        orderId, // ✅ ta function lit orderId
        order_id: orderId, // ✅ compat si tu changes plus tard
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

  if (!clientSecret) {
    throw new Error("clientSecret manquant depuis create_payment_intent.");
  }

  // 2) Charger Stripe natif dynamiquement (évite crash Expo Go au démarrage)
  const stripeNative = await import("@stripe/stripe-react-native");
  const initPaymentSheet = stripeNative.initPaymentSheet;
  const presentPaymentSheet = stripeNative.presentPaymentSheet;

  // 3) Init PaymentSheet
  const init = await initPaymentSheet({
    merchantDisplayName: "MMD Delivery",
    paymentIntentClientSecret: clientSecret,
    allowsDelayedPaymentMethods: true,
  });

  if (init.error) {
    throw new Error(init.error.message);
  }

  // 4) Présenter PaymentSheet
  const present = await presentPaymentSheet();

  if (present.error) {
    if (present.error.code === "Canceled") {
      throw new Error("Paiement annulé.");
    }
    throw new Error(present.error.message);
  }

  return true;
}
