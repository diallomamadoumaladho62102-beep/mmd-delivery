// apps/mobile/src/screens/DriverChatScreen.tsx
import React, { useMemo } from "react";
import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { useSafeBackNavigation } from "../navigation/navigationBack";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type ChatTargetRole = "client" | "restaurant" | "admin";

function isValidTargetRole(value: unknown): value is ChatTargetRole {
  return value === "client" || value === "restaurant" || value === "admin";
}

export function DriverChatScreen() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const safeBack = useSafeBackNavigation("DriverTabs");

  const orderId = String(route?.params?.orderId ?? "").trim();
  const rawTargetRole = route?.params?.targetRole;
  const sourceTable = route?.params?.sourceTable ?? route?.params?.source_table;

  const targetRole: ChatTargetRole = isValidTargetRole(rawTargetRole)
    ? rawTargetRole
    : "admin";

  const titlePrefix = useMemo(() => {
    return t("driver.chat.titlePrefix", "Driver");
  }, [t]);

  if (!orderId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("driver.chat.missing.title", "Chat")}
          subtitle={t("driver.chat.missing.subtitle", "Support")}
          fallbackRoute="DriverTabs"
          onBack={safeBack}
          variant="mmd"
        />

        <View style={styles.center}>
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>❌</Text>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>
                {t("driver.chat.missing.orderTitle", "Order Not Found")}
              </Text>
              <Text style={styles.errorBody}>
                {t(
                  "driver.chat.missing.orderBody",
                  "This order may have been cancelled or is no longer available."
                )}
              </Text>
            </View>
            <View style={styles.divider} />
            <TouchableOpacity
              onPress={safeBack}
              style={styles.goBackBtn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t("common.back", "Go Back")}
            >
              <Text style={styles.goBackText}>
                {t("driver.chat.missing.goBack", "Go Back")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      targetRole={targetRole}
      sourceTable={sourceTable}
      onBack={safeBack}
      titlePrefix={titlePrefix}
      appearance="driver"
    />
  );
}

export default DriverChatScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  errorCard: {
    width: "100%",
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 20,
    padding: 32,
    gap: 20,
    shadowColor: "#000",
    shadowOpacity: 0.13,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  errorIcon: {
    color: MMD_WHITE,
    fontSize: 56,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  errorCopy: {
    alignItems: "center",
    gap: 8,
  },
  errorTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBody: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 18,
  },
  divider: {
    height: 1,
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  goBackBtn: {
    height: 48,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  goBackText: {
    color: MMD_TEXT,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  footerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});
