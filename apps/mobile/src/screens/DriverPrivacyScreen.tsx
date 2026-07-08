import React from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  getLegalPrivacyUrl,
  getLegalTermsUrl,
  getSupportUrl,
  openLegalUrl,
} from "../lib/legalUrls";

type Props = NativeStackScreenProps<RootStackParamList, "DriverPrivacyScreen">;

export default function DriverPrivacyScreen(_props: Props) {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.workAccount.legal.privacy.label", "Privacy")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20 }}>
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
