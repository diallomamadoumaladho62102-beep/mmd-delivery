import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

type ExpoExtra = {
  EXPO_PUBLIC_LEGAL_PRIVACY_URL?: string;
  EXPO_PUBLIC_LEGAL_TERMS_URL?: string;
  EXPO_PUBLIC_SUPPORT_URL?: string;
};

function readExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

export function getLegalPrivacyUrl(): string {
  return (
    readExtra().EXPO_PUBLIC_LEGAL_PRIVACY_URL ||
    "https://www.mmddelivery.com/legal/privacy"
  );
}

export function getLegalTermsUrl(): string {
  return (
    readExtra().EXPO_PUBLIC_LEGAL_TERMS_URL ||
    "https://www.mmddelivery.com/legal/terms"
  );
}

export function getSupportUrl(): string {
  return (
    readExtra().EXPO_PUBLIC_SUPPORT_URL ||
    "https://www.mmddelivery.com/legal/support"
  );
}

export async function openLegalUrl(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url);
}
