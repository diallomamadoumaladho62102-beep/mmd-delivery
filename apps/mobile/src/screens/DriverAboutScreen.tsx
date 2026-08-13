/**
 * Driver About — UI aligned to Figma 294:6160.
 */
import React, { useMemo } from "react";
import {
  ScrollView,
  Text,
  View,
  StyleSheet,
  Image,
  Pressable,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { getActiveSocialLinks } from "../lib/socialLinks";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const PACKAGE_ID = "com.maladho2025.mmddelivery";
const APP_VERSION = "1.0.0";

type Props = NativeStackScreenProps<RootStackParamList, "DriverAboutScreen">;

const SOCIAL_ICON: Record<string, string> = {
  instagram: "📸",
  facebook: "👥",
  x: "🐦",
  twitter: "🐦",
  tiktok: "🎵",
};

export default function DriverAboutScreen(_props: Props) {
  const { t } = useTranslation();
  const socials = useMemo(() => getActiveSocialLinks(), []);

  const infoRows = [
    {
      icon: "📱",
      text: t("driver.about.appVersion", "App: Version {{version}}", {
        version: APP_VERSION,
      }),
    },
    {
      icon: "🏢",
      text: t("driver.about.company", "Company: MMD Delivery"),
    },
    {
      icon: "📦",
      text: t("driver.about.package", "Package: {{id}}", { id: PACKAGE_ID }),
    },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.workAccount.legal.about.label", "About MMD")}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <Image
            source={MMD_LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brandTitle}>MMD Delivery</Text>
          <Text style={styles.tagline}>
            {t(
              "driver.about.tagline",
              "Connecting drivers, restaurants & clients",
            )}
          </Text>
        </View>

        <View style={styles.descCard}>
          <Text style={styles.descText}>
            {t(
              "driver.about.body",
              "MMD Delivery connects restaurants, clients, and independent drivers through a seamless delivery platform. Built with modern technology for fast, secure, and reliable service.",
            )}
          </Text>
        </View>

        <View style={styles.infoSection}>
          {infoRows.map((row) => (
            <View key={row.text} style={styles.infoRow}>
              <Text style={styles.infoIcon}>{row.icon}</Text>
              <Text style={styles.infoText}>{row.text}</Text>
            </View>
          ))}
        </View>

        {socials.length > 0 ? (
          <View style={styles.socialSection}>
            <Text style={styles.socialHeading}>
              {t("driver.about.social", "Follow us")}
            </Text>
            <View style={styles.socialList}>
              {socials.map((link) => (
                <Pressable
                  key={link.id}
                  onPress={() => void Linking.openURL(link.url)}
                  style={({ pressed }) => [
                    styles.socialRow,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel={link.label}
                >
                  <Text style={styles.socialIcon}>
                    {SOCIAL_ICON[link.id] ?? "🔗"}
                  </Text>
                  <Text style={styles.socialLabel}>{link.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t("driver.about.madeWith", "Made with ❤️ for drivers")}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 14,
  },
  brand: { alignItems: "center", gap: 10 },
  logo: { width: 60, height: 60, borderRadius: 14 },
  brandTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
  },
  tagline: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
    textAlign: "center",
  },
  descCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  descText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  infoSection: { gap: 8 },
  infoRow: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoIcon: { fontSize: 13, color: MMD_GOLD_CLASSIC },
  infoText: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  socialSection: { gap: 8 },
  socialHeading: {
    color: "#E2E8F0",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  socialList: { gap: 8 },
  socialRow: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  socialIcon: { fontSize: 18, color: "#CBD5E1" },
  socialLabel: {
    flex: 1,
    color: "#E2E8F0",
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  footer: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  footerText: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.regular,
    fontSize: 11,
  },
});
