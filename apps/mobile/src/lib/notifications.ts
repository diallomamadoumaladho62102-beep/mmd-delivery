// apps/mobile/src/lib/notifications.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Device from "expo-device";

/**
 * 🔔 Handler global
 * Permet d’afficher les notifications même quand l’app est ouverte
 *
 * NOTE (SDK 53+): NotificationBehavior inclut shouldShowBanner / shouldShowList
 */
let handlerInstalled = false;

export function setupNotifications() {
  if (handlerInstalled) return;
  handlerInstalled = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * ✅ Récupère un Expo Push Token (dev build / Expo Go / prod)
 * Retourne null si pas possible (permissions refusées / simulateur / config manquante)
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Simulateur iOS / environnements sans device physique
    if (!Device.isDevice) {
      console.log("ℹ️ Push token: Device.isDevice=false (simulateur?)");
      return null;
    }

    // Permissions
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;

    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }

    if (!granted) {
      console.log("❌ Push token: permissions refusées");
      return null;
    }

    // Android channel (recommandé)
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    // ProjectId (EAS / Expo) — nécessaire sur certaines configs
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      undefined;

    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    return token?.data ?? null;
  } catch (e) {
    console.log("❌ getExpoPushToken error:", e);
    return null;
  }
}