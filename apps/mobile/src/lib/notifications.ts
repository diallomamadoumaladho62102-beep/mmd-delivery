// apps/mobile/src/lib/notifications.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Device from "expo-device";

/**
 * 🔔 Handler global
 * Permet d’afficher les notifications quand l’app est ouverte.
 * Compatible avec expo-notifications SDK 54.
 */
let handlerInstalled = false;

export function setupNotifications(): void {
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
 * ✅ Récupère un Expo Push Token.
 * Retourne null si ce n’est pas possible :
 * - simulateur
 * - permissions refusées
 * - projectId manquant
 * - erreur native Android/iOS
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log("ℹ️ Push token: appareil non physique / simulateur");
      return null;
    }

    const currentPermission = await Notifications.getPermissionsAsync();
    let granted = currentPermission.granted;

    if (!granted) {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      granted = requestedPermission.granted;
    }

    if (!granted) {
      console.log("❌ Push token: permissions refusées");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      null;

    if (!projectId) {
      console.log("❌ Push token: projectId EAS manquant");
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    return token?.data ?? null;
  } catch (error) {
    console.log("❌ getExpoPushToken error:", error);
    return null;
  }
}