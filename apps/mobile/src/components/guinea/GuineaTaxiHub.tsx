import React from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useTranslation } from "react-i18next";

import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../navigation/ScreenHeader";
import { GuineaServiceTabs } from "./GuineaServiceTabs";
import { MMD_BLUE, MMD_WHITE } from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHome">;

export function GuineaTaxiHub() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("guineaMarket.taxiHomeTitle")}
        subtitle={t("guineaMarket.taxiHomeSubtitle")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <View style={styles.body}>
        <GuineaServiceTabs active="taxi" />
        <Text style={styles.question}>{t("guineaMarket.whereTo")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("GuineaTaxiRequest")}
          style={styles.field}
        >
          <Text style={styles.fieldLabel}>{t("guineaMarket.pickup")}</Text>
          <Text style={styles.fieldHint}>{t("guineaMarket.chooseOnMap")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("GuineaTaxiRequest")}
          style={styles.field}
        >
          <Text style={styles.fieldLabel}>{t("guineaMarket.destination")}</Text>
          <Text style={styles.fieldHint}>{t("guineaMarket.chooseOnMap")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("GuineaTaxiRequest")}
          style={styles.cta}
        >
          <Text style={styles.ctaLabel}>{t("guineaMarket.seePrice")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("GuineaXlRequest")}
          style={styles.xlLink}
        >
          <Text style={styles.xlLabel}>{t("guineaMarket.xlLink")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F7FB",
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  question: {
    marginTop: 8,
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800",
  },
  field: {
    minHeight: 72,
    borderRadius: 16,
    backgroundColor: MMD_WHITE,
    borderWidth: 1,
    borderColor: "#D6DEEA",
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  fieldLabel: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  fieldHint: {
    marginTop: 2,
    color: "#64748B",
    fontSize: 14,
  },
  cta: {
    marginTop: 8,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 17,
    fontWeight: "800",
  },
  xlLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  xlLabel: {
    color: MMD_BLUE,
    fontSize: 15,
    fontWeight: "700",
  },
});
