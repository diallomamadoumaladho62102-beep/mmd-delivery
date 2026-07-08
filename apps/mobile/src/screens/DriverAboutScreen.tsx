import React from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";

type Props = NativeStackScreenProps<RootStackParamList, "DriverAboutScreen">;

export default function DriverAboutScreen(_props: Props) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.workAccount.legal.about.label", "About MMD")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ color: "#CBD5E1", lineHeight: 22 }}>
          {t(
            "driver.about.body",
            "MMD Delivery connects restaurants, clients, and independent drivers. Version 1.0.0 — built with Expo and Stripe Connect for secure payouts."
          )}
        </Text>
        <View style={{ marginTop: 24 }}>
          <Text style={{ color: "#94A3B8" }}>MMD Delivery</Text>
          <Text style={{ color: "#64748B", fontSize: 12 }}>com.maladho2025.mmddelivery</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
