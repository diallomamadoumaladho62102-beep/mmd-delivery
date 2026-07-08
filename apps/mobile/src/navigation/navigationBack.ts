import { useCallback } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RootStackParamList } from "./AppNavigator";
import {
  resolveDashboardFallback,
} from "./navigationBackPolicy";

export { resolveDashboardFallback, canShowBackButton } from "./navigationBackPolicy";

export function useSafeBackNavigation(
  fallbackRoute?: keyof RootStackParamList,
) {
  const navigation = useNavigation<any>();
  const route = useRoute();

  return useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    const target =
      fallbackRoute ?? resolveDashboardFallback(route.name as string | undefined);
    navigation.navigate(target as never);
  }, [fallbackRoute, navigation, route.name]);
}
