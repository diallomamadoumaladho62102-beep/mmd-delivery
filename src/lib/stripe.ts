import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

export async function configureDriverPayments(userId: string) {
  const return_url = "https://example.com/stripe-return";
  const refresh_url = "https://example.com/stripe-refresh";

  const { data, error } = await supabase.functions.invoke("stripe_driver_onboarding", {
    body: { user_id: userId, return_url, refresh_url },
  });

  if (error) {
    console.error("Stripe onboarding error:", error);
    throw error;
  }

  await WebBrowser.openBrowserAsync(data.url);
}
