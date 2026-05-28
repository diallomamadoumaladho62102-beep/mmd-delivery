// apps/mobile/src/lib/notifications.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Device from "expo-device";
import { supabase } from "./supabase";

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

export async function getExpoPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const currentPermission = await Notifications.getPermissionsAsync();
    let granted = currentPermission.granted;

    if (!granted) {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      granted = requestedPermission.granted;
    }

    if (!granted) return null;

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

    if (!projectId) return null;

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token?.data ?? null;
  } catch (error) {
    console.log("❌ getExpoPushToken error:", error);
    return null;
  }
}

export async function registerUserPushToken(role: "client" | "driver" | "restaurant" | "admin") {
  try {
    setupNotifications();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) return null;

    const expoPushToken = await getExpoPushToken();
    if (!expoPushToken) return null;

    const deviceId =
      (Constants as any)?.sessionId ??
      `${Platform.OS}-${Device.osInternalBuildId ?? Device.modelId ?? "device"}`;

    const appVersion =
      (Constants as any)?.expoConfig?.version ??
      (Constants as any)?.nativeAppVersion ??
      null;

    const { error } = await supabase.from("user_push_tokens").upsert(
      {
        user_id: user.id,
        device_id: String(deviceId),
        role,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        app_version: appVersion,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,device_id,role",
      }
    );

    if (error) {
      console.log("❌ registerUserPushToken Supabase error:", error);
      return null;
    }

    return expoPushToken;
  } catch (error) {
    console.log("❌ registerUserPushToken error:", error);
    return null;
  }
}