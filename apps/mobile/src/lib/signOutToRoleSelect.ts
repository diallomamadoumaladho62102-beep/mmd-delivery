/**
 * Shared mobile sign-out → RoleSelect (core, Node-testable with injected deps).
 */
import { AUTH_ACTION_TIMEOUT_MS, withTimeout } from "./bootFailOpen";

export type SignOutNavigation = {
  reset: (state: {
    index: number;
    routes: Array<{ name: "RoleSelect" }>;
  }) => void;
};

export type SignOutDeps = {
  clearSelectedRole?: () => Promise<void>;
  signOut?: () => Promise<{ error: Error | null }>;
};

/**
 * Clears selected role, ends Supabase auth session, resets nav stack to RoleSelect.
 * Callers that hold realtime channels should unmount (reset) so effect cleanups run.
 *
 * Default auth/role implementations are loaded lazily so Node unit tests can inject
 * deps without pulling React Native / AsyncStorage.
 */
export async function signOutToRoleSelect(
  navigation: SignOutNavigation,
  deps: SignOutDeps = {},
): Promise<void> {
  const clearRole =
    deps.clearSelectedRole ??
    (await import("./authRole")).clearSelectedRole;
  const doSignOut =
    deps.signOut ??
    (async () => {
      const { supabase } = await import("./supabase");
      const { error } = await supabase.auth.signOut();
      return { error: error ? new Error(error.message) : null };
    });

  await withTimeout(clearRole(), AUTH_ACTION_TIMEOUT_MS, "sign_out_clear_role");
  const { error } = await withTimeout(
    doSignOut(),
    AUTH_ACTION_TIMEOUT_MS,
    "sign_out_auth",
  );
  if (error) throw error;
  navigation.reset({
    index: 0,
    routes: [{ name: "RoleSelect" }],
  });
}

export type ConfirmSignOutLabels = {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  errorTitle?: string;
  errorBody?: string;
};

/** Stable i18n defaults for Restaurant logout (EN primary for App Store). */
export function restaurantSignOutLabels(t: (key: string, fallback: string) => string) {
  return {
    title: t("restaurant.signOut.title", "Log out"),
    body: t(
      "restaurant.signOut.body",
      "Sign out of this device? Your restaurant account and data stay intact.",
    ),
    confirm: t("restaurant.signOut.confirm", "Log out"),
    cancel: t("common.cancel", "Cancel"),
    errorTitle: t("common.error", "Error"),
    errorBody: t(
      "restaurant.signOut.error",
      "Unable to sign out right now.",
    ),
  } satisfies ConfirmSignOutLabels;
}

/** Stable i18n defaults for Driver logout (EN primary for App Store). */
export function driverSignOutLabels(t: (key: string, fallback: string) => string) {
  return {
    title: t("driver.signOut.title", "Log out"),
    body: t(
      "driver.signOut.body",
      "Sign out of this device? Your driver account and data stay intact.",
    ),
    confirm: t("common.logout", "Log out"),
    cancel: t("common.cancel", "Cancel"),
    errorTitle: t("common.errorTitle", "Error"),
    errorBody: t(
      "driver.account.logoutFailed",
      "Something went wrong temporarily. Please try again.",
    ),
  } satisfies ConfirmSignOutLabels;
}

/** Stable i18n defaults for Seller logout (EN primary for App Store). */
export function sellerSignOutLabels(t: (key: string, fallback: string) => string) {
  return {
    title: t("seller.signOut.title", "Log out"),
    body: t(
      "seller.signOut.body",
      "Sign out of this device? Your seller account and products stay intact.",
    ),
    confirm: t("common.logout", "Log out"),
    cancel: t("common.cancel", "Cancel"),
    errorTitle: t("common.errorTitle", "Error"),
    errorBody: t(
      "seller.signOut.error",
      "Unable to sign out right now.",
    ),
  } satisfies ConfirmSignOutLabels;
}
