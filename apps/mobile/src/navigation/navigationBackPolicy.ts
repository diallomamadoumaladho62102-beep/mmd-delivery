import type { RootStackParamList } from "../navigation/AppNavigator";

export function resolveDashboardFallback(
  routeName: string | undefined,
): keyof RootStackParamList {
  const name = String(routeName ?? "");

  if (
    name.startsWith("Client") ||
    name.startsWith("Taxi") ||
    name.startsWith("Marketplace") ||
    name.startsWith("Mmd") ||
    name.startsWith("MMD") ||
    name === "DeliveryRequest" ||
    name === "LoyaltyHub" ||
    name === "Promotions"
  ) {
    return "ClientHome";
  }

  if (name.startsWith("Driver")) {
    return "DriverTabs";
  }

  if (name.startsWith("Restaurant")) {
    return "RestaurantCommandCenter";
  }

  if (name.startsWith("Seller")) {
    return "SellerDashboard";
  }

  return "RoleSelect";
}

export function canShowBackButton(navigation: { canGoBack?: () => boolean }) {
  return Boolean(navigation.canGoBack?.());
}
