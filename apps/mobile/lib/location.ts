import * as Location from "expo-location";
import { supabase } from "./supabase";

let trackingInterval: ReturnType<typeof setInterval> | null = null;

// ✅ Récupérer la position actuelle une fois
export async function getCurrentLocation() {
  // Demande de permission si pas encore accordée
  const { status } = await Location.requestForegroundPermissionsAsync();

  if (status !== "granted") {
    throw new Error(
      "Permission localisation refusée. Active le GPS dans les réglages."
    );
  }

  const pos = await Location.getCurrentPositionAsync({});
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
  };
}

// ✅ Envoyer la position au serveur (table driver_locations)
async function sendDriverLocationToServer(
  userId: string,
  latitude: number,
  longitude: number
) {
  const { error } = await supabase.from("driver_locations").upsert({
    user_id: userId,
    latitude,
    longitude,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.log("❌ Erreur upsert driver_locations:", error.message);
  } else {
    // console.log("✅ Position driver mise à jour sur le serveur");
  }
}

// ✅ Démarrer le tracking régulier pour le chauffeur
export async function startDriverLocationTracking(options?: {
  intervalMs?: number;
}) {
  const intervalMs = options?.intervalMs ?? 5000;

  // Si un tracking existe déjà, on ne le recrée pas
  if (trackingInterval) {
    console.log("ℹ️ Tracking GPS déjà actif.");
    return;
  }

  // 🔎 Vérifier la session Supabase
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.log("ℹ️ GPS: erreur getSession, tracking désactivé:", error.message);
    return;
  }

  const session = data.session;
  if (!session) {
    // 👉 On ne logue plus "Auth session missing!" comme une erreur.
    console.log(
      "ℹ️ GPS: pas de session auth, tracking non démarré (attendre connexion)."
    );
    return;
  }

  const userId = session.user.id;

  // Demande de permission localisation
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    console.log(
      "ℹ️ GPS: permission refusée, impossible de démarrer le tracking."
    );
    return;
  }

  // 🔁 Fonction interne qui récupère la position et l’envoie au serveur
  const tick = async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({});
      await sendDriverLocationToServer(
        userId,
        pos.coords.latitude,
        pos.coords.longitude
      );
    } catch (e: any) {
      console.log("ℹ️ GPS: erreur tick tracking:", e?.message ?? e);
    }
  };

  // Premier envoi immédiat
  await tick();

  // Puis intervalle régulier
  trackingInterval = setInterval(tick, intervalMs);
  console.log("✅ Tracking GPS chauffeur démarré (intervalle:", intervalMs, "ms)");
}

// ✅ Stopper le tracking
export function stopDriverLocationTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
    console.log("🛑 Tracking GPS chauffeur arrêté.");
  }
}
