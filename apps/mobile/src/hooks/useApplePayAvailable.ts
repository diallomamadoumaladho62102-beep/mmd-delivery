import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { shouldShowApplePayButton } from "../lib/applePayCheckout";

/**
 * True only when iOS reports a usable Apple Pay wallet.
 * Never show a fake Apple Pay button when this is false.
 */
export function useApplePayAvailable(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setSupported(false);
      return;
    }
    let alive = true;
    void import("@stripe/stripe-react-native")
      .then(async (stripeNative) => {
        if (!alive || typeof stripeNative.isPlatformPaySupported !== "function") {
          return;
        }
        const ok = await stripeNative.isPlatformPaySupported();
        if (alive) setSupported(ok === true);
      })
      .catch(() => {
        if (alive) setSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return shouldShowApplePayButton({
    platform: Platform.OS,
    isPlatformPaySupported: supported,
  });
}
