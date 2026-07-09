import { useCallback, useState } from "react";
import { toUserFacingError } from "../lib/userFacingError";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useRestaurantPlatformFeatures } from "./useRestaurantPlatformFeatures";

export function useRestaurantAvailability() {
  const { t } = useTranslation();
  const { refresh: refreshRestaurantPlatformFeatures } = useRestaurantPlatformFeatures();
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const updateRestaurantAvailability = useCallback(
    async (restaurantUserId: string, nextValue: boolean) => {
      if (!restaurantUserId) {
        throw new Error("Missing restaurant user id");
      }

      if (nextValue) {
        const scopeFeatures = await refreshRestaurantPlatformFeatures();
        if (!scopeFeatures.can_accept_orders) {
          throw new Error(
            scopeFeatures.message ??
              t(
                "restaurant.platformUnavailable",
                "Food delivery is currently disabled in your county.\n\nOrders cannot be received until this county is activated."
              )
          );
        }
      }

      const { error } = await supabase
        .from("restaurant_profiles")
        .update({
          is_accepting_orders: nextValue,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", restaurantUserId);

      if (error) {
        throw new Error(toUserFacingError(error, "Unable to change restaurant status."));
      }

      return nextValue;
    },
    [refreshRestaurantPlatformFeatures, t]
  );

  const confirmToggleAvailability = useCallback(
    (params: {
      restaurantUserId: string;
      currentlyOpen: boolean;
      onSuccess?: (nextOpen: boolean) => void;
    }) => {
      const { restaurantUserId, currentlyOpen, onSuccess } = params;
      const nextValue = !currentlyOpen;

      Alert.alert(
        currentlyOpen
          ? t("restaurant.dashboard.goOfflineTitle", "Go offline")
          : t("restaurant.dashboard.goOnlineTitle", "Go online"),
        currentlyOpen
          ? t(
              "restaurant.dashboard.goOfflineConfirm",
              "Stop receiving new orders for now?"
            )
          : t(
              "restaurant.dashboard.goOnlineConfirm",
              "Start receiving new orders now?"
            ),
        [
          { text: t("common.cancel", "Cancel"), style: "cancel" },
          {
            text: t("common.yes", "Yes"),
            onPress: () => {
              void (async () => {
                try {
                  setAvailabilityLoading(true);
                  const applied = await updateRestaurantAvailability(
                    restaurantUserId,
                    nextValue
                  );
                  onSuccess?.(applied);
                } catch (e: unknown) {
                  Alert.alert(
                    t("common.errorTitle", "Error"),
                    e instanceof Error
                      ? e.message
                      : t(
                          "restaurant.dashboard.availabilityUpdateFailed",
                          "Unable to change restaurant status."
                        )
                  );
                } finally {
                  setAvailabilityLoading(false);
                }
              })();
            },
          },
        ]
      );
    },
    [t, updateRestaurantAvailability]
  );

  return {
    availabilityLoading,
    confirmToggleAvailability,
    updateRestaurantAvailability,
  };
}
