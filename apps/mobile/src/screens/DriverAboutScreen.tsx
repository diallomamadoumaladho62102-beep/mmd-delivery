import React from "react";
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "DriverAboutScreen">;

export default function DriverAboutScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 16 }}>
          <Text style={{ color: "#94A3B8" }}>← {t("common.back", "Back")}</Text>
        </TouchableOpacity>
        <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "700", marginBottom: 12 }}>
          {t("driver.workAccount.legal.about.label", "About MMD")}
        </Text>
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
