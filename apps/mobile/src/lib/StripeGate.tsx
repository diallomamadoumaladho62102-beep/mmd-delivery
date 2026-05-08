import React from "react";
import Constants from "expo-constants";
import { StripeProvider } from "@stripe/stripe-react-native";
import { AppNavigator } from "../navigation/AppNavigator";

type StripeGateProps = {
  initialRouteName?: string;
};

const publishableKey = String(
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_STRIPE_PK ?? ""
).trim();

export default function StripeGate({ initialRouteName }: StripeGateProps) {
  if (!publishableKey) {
    console.log("Missing EXPO_PUBLIC_STRIPE_PK in app.json extra");
    return <AppNavigator initialRouteName={initialRouteName as any} />;
  }

  return (
    <StripeProvider publishableKey={publishableKey}>
      <AppNavigator initialRouteName={initialRouteName as any} />
    </StripeProvider>
  );
}