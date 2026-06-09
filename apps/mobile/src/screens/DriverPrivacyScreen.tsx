import React from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getLegalPrivacyUrl,
  getLegalTermsUrl,
  getSupportUrl,
  openLegalUrl,
} from "../lib/legalUrls";

type Props = NativeStackScreenProps<RootStackParamList, "DriverPrivacyScreen">;

export default function DriverPrivacyScreen({ navigation }: Props) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 16 }}>
          <Text style={{ color: "#94A3B8" }}>← {t("common.back", "Back")}</Text>
        </TouchableOpacity>
        <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "700", marginBottom: 12 }}>
          {t("driver.workAccount.legal.privacy.label", "Privacy")}
        </Text>
        <Text style={{ color: "#CBD5E1", lineHeight: 22 }}>
          {t(
            "driver.privacy.body",
            "MMD Delivery collects location data for active deliveries, account information for payouts, and photos you upload as delivery proof. Data is stored securely on Supabase and processed according to our terms. Contact support for data requests."
          )}
        </Text>
        <View style={{ marginTop: 24, gap: 12 }}>
          <TouchableOpacity onPress={() => void openLegalUrl(getLegalPrivacyUrl())}>
            <Text style={{ color: "#60A5FA", fontSize: 14 }}>
              {t("legal.openPrivacy", "Open privacy policy")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void openLegalUrl(getLegalTermsUrl())}>
            <Text style={{ color: "#60A5FA", fontSize: 14 }}>
              {t("legal.openTerms", "Open terms of service")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void openLegalUrl(getSupportUrl())}>
            <Text style={{ color: "#60A5FA", fontSize: 14 }}>
              {t("legal.openSupport", "Contact support")}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
