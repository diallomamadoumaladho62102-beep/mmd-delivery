/**
 * Expo Updates (OTA) bootstrap for production builds.
 *
 * Keeps JS/TS UI, validation, and business-logic fixes deliverable without
 * a new App Store / Play Store binary whenever runtimeVersion matches.
 *
 * Native rebuild is still required when: native modules, permissions,
 * plugins, app.json / app.config native fields, or runtimeVersion change.
 */
import { Platform } from "react-native";

export async function checkAndApplyExpoUpdates(options?: {
  /** When true, reload immediately after downloading an update. Default true. */
  reloadOnUpdate?: boolean;
}): Promise<{
  checked: boolean;
  isAvailable: boolean;
  applied: boolean;
  reason?: string;
}> {
  const reloadOnUpdate = options?.reloadOnUpdate !== false;

  // Never block Expo Go / local Metro on update checks.
  if (__DEV__) {
    return { checked: false, isAvailable: false, applied: false, reason: "dev" };
  }

  try {
    const Updates = await import("expo-updates");

    if (!Updates.isEnabled) {
      return {
        checked: false,
        isAvailable: false,
        applied: false,
        reason: "updates_disabled",
      };
    }

    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      return { checked: true, isAvailable: false, applied: false };
    }

    await Updates.fetchUpdateAsync();

    if (reloadOnUpdate && Updates.reloadAsync) {
      // Give the event loop a tick so logs flush on some devices.
      await Promise.resolve();
      await Updates.reloadAsync();
    }

    return { checked: true, isAvailable: true, applied: true };
  } catch (error) {
    console.log(
      `[expoOtaUpdates] check failed (${Platform.OS}):`,
      error instanceof Error ? error.message : String(error),
    );
    return {
      checked: false,
      isAvailable: false,
      applied: false,
      reason: "error",
    };
  }
}
