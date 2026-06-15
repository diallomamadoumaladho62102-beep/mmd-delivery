import React from "react";
import { SafeAreaView, StatusBar, View, Text, TouchableOpacity } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MMDLocationPicker, {
  type MMDLocationPickerValue,
} from "../components/location/MMDLocationPicker";
import type { MmdLocationPickerContext } from "../lib/mmdLocationDisplay";
import { rowDirection } from "../i18n/rtl";

type Nav = NativeStackNavigationProp<RootStackParamList, "MMDLocationPicker">;
type PickerRoute = RouteProp<RootStackParamList, "MMDLocationPicker">;

export default function MMDLocationPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<PickerRoute>();
  const { t } = useTranslation();
  const {
    countryCode: routeCountryCode,
    title,
    submitLabel,
    returnTo,
    pickerContext,
  } = route.params;

  const resolvedCountryCode = String(routeCountryCode ?? "").trim().toUpperCase();
  if (!resolvedCountryCode) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A", padding: 20 }}>
        <Text style={{ color: "#FCA5A5" }}>
          {t("location.missingMarketScope", "Market scope is required for this picker.")}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={{ color: "#94A3B8" }}>{t("common.back", "Back")}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const resolvedTitle = title ?? t("location.exactLocation", "Exact location");
  const resolvedSubmitLabel = submitLabel ?? t("location.useLocation", "Use this location");

  async function handleSave(value: MMDLocationPickerValue) {
    const result = {
      context: pickerContext as MmdLocationPickerContext,
      location: value.location,
    };

    navigation.navigate({
      name: returnTo,
      params: { locationPickerResult: result },
      merge: true,
    } as never);

    navigation.goBack();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <StatusBar barStyle="light-content" />
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: "#1E293B",
          flexDirection: rowDirection(),
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#94A3B8", fontWeight: "600" }}>
            {t("common.back", "Back")}
          </Text>
        </TouchableOpacity>
        <Text style={{ color: "#F8FAFC", fontWeight: "700" }} numberOfLines={1}>
          {resolvedTitle}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <MMDLocationPicker
        countryCode={resolvedCountryCode}
        title={resolvedTitle}
        submitLabel={resolvedSubmitLabel}
        onSave={handleSave}
        onCancel={() => navigation.goBack()}
      />
    </SafeAreaView>
  );
}
