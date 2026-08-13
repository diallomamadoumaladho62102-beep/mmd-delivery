/**
 * Driver Privacy — UI aligned to Figma 294:6144.
 */
import React from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  Image,
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
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type Props = NativeStackScreenProps<RootStackParamList, "DriverPrivacyScreen">;

const POLICY_CARDS = [
  {
    icon: "📍",
    titleKey: "driver.privacy.locationTitle",
    titleFallback: "Location Data",
    bodyKey: "driver.privacy.locationBody",
    bodyFallback:
      "We collect location data only during active deliveries to ensure accurate tracking and routing.",
  },
  {
    icon: "👤",
    titleKey: "driver.privacy.accountTitle",
    titleFallback: "Account Information",
    bodyKey: "driver.privacy.accountBody",
    bodyFallback:
      "Your account details are securely stored for payout processing and identity verification.",
  },
  {
    icon: "📸",
    titleKey: "driver.privacy.proofTitle",
    titleFallback: "Delivery Proof",
    bodyKey: "driver.privacy.proofBody",
    bodyFallback:
      "Photos uploaded as delivery proof are stored securely and processed according to our terms.",
  },
] as const;

export default function DriverPrivacyScreen(_props: Props) {
  const { t } = useTranslation();

  const links = [
    {
      label: t("legal.openPrivacy", "Privacy Policy"),
      onPress: () => void openLegalUrl(getLegalPrivacyUrl()),
    },
    {
      label: t("legal.openTerms", "Terms of Service"),
      onPress: () => void openLegalUrl(getLegalTermsUrl()),
    },
    {
      label: t("legal.openSupport", "Contact Support"),
      onPress: () => void openLegalUrl(getSupportUrl()),
    },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.workAccount.legal.privacy.label", "Privacy")}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.lockCircle}>
            <Text style={styles.lockIcon}>🔒</Text>
          </View>
          <Text style={styles.heroTitle}>
            {t("driver.privacy.heroTitle", "Your data is protected")}
          </Text>
        </View>

        <Text style={styles.intro}>
          {t(
            "driver.privacy.intro",
            "At MMD Delivery, we take your privacy seriously. We only collect the data necessary to ensure safe and efficient deliveries. Your information is stored securely and processed according to our strict policies.",
          )}
        </Text>

        <View style={styles.cards}>
          {POLICY_CARDS.map((card) => (
            <View key={card.titleKey} style={styles.policyCard}>
              <Text style={styles.policyIcon}>{card.icon}</Text>
              <View style={styles.policyText}>
                <Text style={styles.policyTitle}>{t(card.titleKey, card.titleFallback)}</Text>
                <Text style={styles.policyBody}>{t(card.bodyKey, card.bodyFallback)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.links}>
          {links.map((link) => (
            <TouchableOpacity
              key={link.label}
              onPress={link.onPress}
              activeOpacity={0.85}
              style={styles.linkRow}
            >
              <Text style={styles.linkLabel}>{link.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Image
            source={MMD_LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.logoLabel}>MMD Delivery</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 16 },
  hero: { alignItems: "center", gap: 6 },
  lockCircle: {
    width: 48,
    height: 48,
    borderRadius: 32,
    backgroundColor: MMD_ACTION_NAVY,
    alignItems: "center",
    justifyContent: "center",
  },
  lockIcon: { fontSize: 24 },
  heroTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
    textAlign: "center",
  },
  intro: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  cards: { gap: 10 },
  policyCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  policyIcon: { fontSize: 20 },
  policyText: { flex: 1, minWidth: 0, gap: 2 },
  policyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  policyBody: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  links: { gap: 8 },
  linkRow: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  chevron: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  footer: { alignItems: "center", paddingTop: 16, paddingBottom: 8, gap: 6 },
  logo: { width: 44, height: 44, borderRadius: 10 },
  logoLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
});
