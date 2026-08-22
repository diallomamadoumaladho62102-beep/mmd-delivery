/**
 * Alert-based confirm wrapper around signOutToRoleSelect (RN runtime only).
 */
import { Alert } from "react-native";
import {
  driverSignOutLabels,
  restaurantSignOutLabels,
  signOutToRoleSelect,
  type ConfirmSignOutLabels,
  type SignOutDeps,
  type SignOutNavigation,
} from "./signOutToRoleSelect";

export type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

export type AlertFn = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
) => void;

/**
 * Destructive confirm (Alert) then signOutToRoleSelect.
 * Matches Client profile/settings convention.
 */
export function confirmSignOutToRoleSelect(params: {
  navigation: SignOutNavigation;
  labels: ConfirmSignOutLabels;
  onBusyChange?: (busy: boolean) => void;
  formatError?: (error: unknown, fallback: string) => string;
  deps?: SignOutDeps;
  alertFn?: AlertFn;
}): void {
  const {
    navigation,
    labels,
    onBusyChange,
    formatError,
    deps,
    alertFn = Alert.alert.bind(Alert) as AlertFn,
  } = params;

  alertFn(labels.title, labels.body, [
    { text: labels.cancel, style: "cancel" },
    {
      text: labels.confirm,
      style: "destructive",
      onPress: () => {
        void (async () => {
          onBusyChange?.(true);
          try {
            await signOutToRoleSelect(navigation, deps);
          } catch (e) {
            const fallback =
              labels.errorBody ?? "Unable to sign out right now.";
            const message = formatError
              ? formatError(e, fallback)
              : e instanceof Error
                ? e.message
                : fallback;
            alertFn(labels.errorTitle ?? "Error", message);
          } finally {
            onBusyChange?.(false);
          }
        })();
      },
    },
  ]);
}

export { restaurantSignOutLabels, driverSignOutLabels, signOutToRoleSelect };
export type { ConfirmSignOutLabels, SignOutDeps, SignOutNavigation };
