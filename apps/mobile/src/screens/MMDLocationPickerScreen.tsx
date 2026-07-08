import React from "react";
import { StatusBar, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MMDLocationPicker, {
  type MMDLocationPickerValue,
} from "../components/location/MMDLocationPicker";
import type { MmdLocationPickerContext } from "../lib/mmdLocationDisplay";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { useSafeBackNavigation } from "../navigation/navigationBack";

type Nav = NativeStackNavigationProp<RootStackParamList, "MMDLocationPicker">;
type PickerRoute = RouteProp<RootStackParamList, "MMDLocationPicker">;

export default function MMDLocationPickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<PickerRoute>();
  const { t } = useTranslation();
  const safeBack = useSafeBackNavigation("ClientHome");
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
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("location.exactLocation", "Exact location")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <View style={{ padding: 20 }}>
          <Text style={{ color: "#FCA5A5" }}>
            {t("location.missingMarketScope", "Market scope is required for this picker.")}
          </Text>
          <TouchableOpacity onPress={safeBack} style={{ marginTop: 12 }}>
            <Text style={{ color: "#94A3B8" }}>{t("common.back", "Back")}</Text>
          </TouchableOpacity>
        </View>
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={resolvedTitle}
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <MMDLocationPicker
        countryCode={resolvedCountryCode}
        title={resolvedTitle}
        submitLabel={resolvedSubmitLabel}
        onSave={handleSave}
        onCancel={safeBack}
      />
    </SafeAreaView>
  );
}
