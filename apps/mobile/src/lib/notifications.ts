// apps/mobile/src/lib/notifications.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Device from "expo-device";
import { supabase } from "./supabase";

let handlerInstalled = false;

export type MobilePushRole = "client" | "driver" | "restaurant" | "seller";

const MOBILE_PUSH_ROLES: MobilePushRole[] = [
  "client",
  "driver",
  "restaurant",
  "seller",
];

function isMobilePushRole(value: unknown): value is MobilePushRole {
  return typeof value === "string" && MOBILE_PUSH_ROLES.includes(value as MobilePushRole);
}

export function setupNotifications(): void {
  if (handlerInstalled) return;

  handlerInstalled = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
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

      await Notifications.setNotificationChannelAsync("driver-missions", {
        name: "Missions chauffeur",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 400, 200, 400, 200, 400],
        lightColor: "#2563EB",
        sound: "mmd_signature_driver_60s.wav",
        enableVibrate: true,
        bypassDnd: false,
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

/** Authoritative push role from profiles.role — never AsyncStorage alone. */
export async function resolvePushRoleForUser(
  userId: string,
): Promise<MobilePushRole | null> {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    console.log("❌ resolvePushRoleForUser error:", error);
    return null;
  }

  const role = String(data?.role ?? "")
    .trim()
    .toLowerCase();

  return isMobilePushRole(role) ? role : null;
}

/**
 * Registers the Expo push token under the DB profile role.
 * If expectedRole is provided it must match profiles.role or registration is skipped.
 */
export async function registerUserPushToken(
  expectedRole?: MobilePushRole,
): Promise<string | null> {
  try {
    setupNotifications();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) return null;

    const dbRole = await resolvePushRoleForUser(user.id);
    if (!dbRole) {
      console.log("❌ registerUserPushToken skipped: unsupported profile role");
      return null;
    }

    if (expectedRole && expectedRole !== dbRole) {
      console.log("❌ registerUserPushToken role mismatch", {
        expectedRole,
        dbRole,
      });
      return null;
    }

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
        role: dbRole,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        app_version: appVersion,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,device_id,role",
      },
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
