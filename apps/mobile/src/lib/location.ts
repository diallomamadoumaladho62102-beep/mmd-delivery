import * as Location from "expo-location";
import { supabase } from "./supabase";

let isTrackingStarted = false;
let locationSubscription: Location.LocationSubscription | null = null;

type TrackingOptions = {
  /** fréquence d’envoi au serveur, en millisecondes */
  intervalMs?: number;
};

/**
 * Ton compte chauffeur DEV (pour login automatique en développement)
 */
const DEV_DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const DEV_DRIVER_PASSWORD = "mmd12345";

/**
 * Essaie de récupérer la session Supabase.
 * Si elle n'existe pas → login automatique avec le compte DEV.
 */
async function getOrLoginDriverUser() {
  const { data, error } = await supabase.auth.getUser();
  console.log("AUTH DATA (mobile):", data);
  console.log("AUTH ERROR (mobile):", error);

  // Si user déjà connecté → OK
  if (!error && data?.user) {
    return data.user;
  }

  console.log(
    "ℹ️ Pas de session active. Tentative de login DEV avec le chauffeur..."
  );

  // Tentative de login DEV
  const { data: loginData, error: loginError } =
    await supabase.auth.signInWithPassword({
      email: DEV_DRIVER_EMAIL,
      password: DEV_DRIVER_PASSWORD,
    });

  if (loginError || !loginData?.user) {
    console.log(
      "❌ Impossible de se connecter avec le compte DEV:",
      loginError?.message ?? "user manquant"
    );
    return null;
  }

  console.log("✅ Login DEV réussi pour:", loginData.user.id);
  return loginData.user;
}

/**
 * Démarre le tracking GPS du chauffeur.
 * - nécessite un user Supabase (session ou login dev)
 * - met driver_profiles.is_online = true
 * - enregistre la position dans driver_locations (UPSERT sur driver_id)
 */
export async function startDriverLocationTracking(
  options: TrackingOptions = {}
) {
  const intervalMs = options.intervalMs ?? 5000;

  try {
    if (isTrackingStarted && locationSubscription) {
      console.log("ℹ️ Tracking déjà actif, on ne relance pas.");
      return;
    }

    // 1) Récupération / login
    const user = await getOrLoginDriverUser();
    if (!user) {
      console.log("❌ Aucun utilisateur chauffeur, tracking annulé.");
      return;
    }

    const driverId = user.id;
    const driverEmail = user.email ?? null;
    console.log("👤 Driver utilisé pour le tracking:", driverId, "-", driverEmail);

    // 2) Mettre en ligne
    const { error: profileError } = await supabase
      .from("driver_profiles")
      .update({ is_online: true })
      .eq("user_id", driverId);

    if (profileError) {
      console.log(
        "❌ Erreur mise à jour driver_profiles.is_online (true):",
        profileError
      );
    } else {
      console.log("✅ driver_profiles.is_online mis à TRUE pour", driverId);
    }

    // 3) Permissions GPS
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.log("🚫 Permission GPS refusée");
      return;
    }

    console.log(
      `📍 Tracking GPS démarré pour ${driverId} (intervalle = ${intervalMs}ms)`
    );

    // 4) Tracking continu
    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: intervalMs,
        distanceInterval: 5,
      },
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;

          // ✅ FIX IMPORTANT : upsert + onConflict driver_id
          const { error } = await supabase.from("driver_locations").upsert(
            {
              driver_id: driverId,
              lat: latitude,
              lng: longitude,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "driver_id" }
          );

          if (error) {
            console.log("❌ driver_locations upsert error:", error);
          } else {
            console.log("✅ GPS envoyé:", latitude, longitude);
          }
        } catch (e: any) {
          console.log(
            "❌ Erreur callback tracking GPS:",
            e?.message ?? String(e)
          );
        }
      }
    );

    isTrackingStarted = true;
  } catch (e: any) {
    console.log("❌ Erreur startDriverLocationTracking:", e?.message ?? e);
  }
}

/**
 * Arrête le tracking
 * - arrête watchPositionAsync
 * - met driver_profiles.is_online = false
 */
export async function stopDriverLocationTracking() {
  try {
    if (locationSubscription) {
      locationSubscription.remove();
      locationSubscription = null;
    }
    isTrackingStarted = false;
    console.log("🛑 Tracking GPS arrêté.");

    const user = await getOrLoginDriverUser();
    if (!user) {
      console.log("ℹ️ stopTracking: aucun user chauffeur disponible.");
      return;
    }

    const driverId = user.id;
    console.log("👤 stopTracking pour driver:", driverId);

    const { error: profileError } = await supabase
      .from("driver_profiles")
      .update({ is_online: false })
      .eq("user_id", driverId);

    if (profileError) {
      console.log(
        "❌ Erreur mise à jour driver_profiles.is_online (false):",
        profileError
      );
    } else {
      console.log("✅ driver_profiles.is_online mis à FALSE pour", driverId);
    }
  } catch (e: any) {
    console.log(
      "❌ Erreur stopDriverLocationTracking:",
      e?.message ?? String(e)
    );
  }
}
