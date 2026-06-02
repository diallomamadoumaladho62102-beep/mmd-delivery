import { Alert, Linking, Platform } from "react-native";
import { isValidCoordinate } from "./coordinates";

export type ExternalNavigationProvider = "google" | "waze" | "apple";

export type ExternalNavigationTarget = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function hasCoordinate(target: ExternalNavigationTarget): boolean {
  return isValidCoordinate(target.latitude, target.longitude);
}

export function openGoogleMapsNavigation(
  target: ExternalNavigationTarget,
  errorTitle = "Erreur",
  errorMessage = "Impossible d'ouvrir Google Maps sur ce téléphone.",
): void {
  if (hasCoordinate(target)) {
    const lat = Number(target.latitude);
    const lng = Number(target.longitude);
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${lat},${lng}`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

    Linking.openURL(url).catch(() => {
      Alert.alert(errorTitle, errorMessage);
    });
    return;
  }

  const address = String(target.address || "").trim();
  if (!address) {
    Alert.alert(errorTitle, "Aucune adresse disponible pour cette étape.");
    return;
  }

  const encoded = encodeURIComponent(address);
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${encoded}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;

  Linking.openURL(url).catch(() => {
    Alert.alert(errorTitle, errorMessage);
  });
}

export function openWazeNavigation(
  target: ExternalNavigationTarget,
  errorTitle = "Erreur",
  errorMessage = "Impossible d'ouvrir Waze sur ce téléphone.",
): void {
  const hasCoords = hasCoordinate(target);
  const encodedAddress = encodeURIComponent(String(target.address || "").trim());

  if (!hasCoords && !encodedAddress) {
    Alert.alert(errorTitle, "Aucune adresse disponible pour cette étape.");
    return;
  }

  const lat = Number(target.latitude);
  const lng = Number(target.longitude);

  const deepLink = hasCoords
    ? `waze://?ll=${lat},${lng}&navigate=yes`
    : `waze://?q=${encodedAddress}&navigate=yes`;

  const fallbackUrl = hasCoords
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;

  Linking.openURL(deepLink).catch(() => {
    Linking.openURL(fallbackUrl).catch(() => {
      Alert.alert(errorTitle, errorMessage);
    });
  });
}

export function openAppleMapsNavigation(target: ExternalNavigationTarget): void {
  if (Platform.OS !== "ios") {
    openGoogleMapsNavigation(target);
    return;
  }

  openGoogleMapsNavigation(target);
}

export function openExternalNavigation(
  provider: ExternalNavigationProvider,
  target: ExternalNavigationTarget,
): void {
  switch (provider) {
    case "waze":
      openWazeNavigation(target);
      break;
    case "apple":
      openAppleMapsNavigation(target);
      break;
    case "google":
    default:
      openGoogleMapsNavigation(target);
      break;
  }
}
