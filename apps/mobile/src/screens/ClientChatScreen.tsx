// apps/mobile/src/screens/ClientChatScreen.tsx
import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StatusBar, StyleSheet, Image, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { useSafeBackNavigation } from "../navigation/navigationBack";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GREEN,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type ChatTargetRole = "restaurant" | "driver" | "admin";

function isValidTargetRole(value: unknown): value is ChatTargetRole {
  return value === "restaurant" || value === "driver" || value === "admin";
}

export function ClientChatScreen() {
  const route = useRoute<any>();
  const { t } = useTranslation();
  const safeBack = useSafeBackNavigation("ClientHome");
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(mmdLogoSizeCompact(width, height), 55);

  const orderId = String(route?.params?.orderId ?? "").trim();
  const rawTargetRole = route?.params?.targetRole;
  const sourceTable = route?.params?.sourceTable ?? route?.params?.source_table;
  const targetRole: ChatTargetRole = isValidTargetRole(rawTargetRole)
    ? rawTargetRole
    : "admin";

  const titlePrefix = useMemo(() => {
    return t("client.chat.titlePrefix", "Client");
  }, [t]);

  if (!orderId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("client.chat.titlePrefix", "Client")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <View style={styles.empty}>
          <Image
            source={MMD_LOGO}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brand}>MMD Delivery</Text>
          <Text style={styles.emptyTitle}>{t("client.chat.titlePrefix", "Chat")}</Text>
          <Text style={styles.emptySub}>
            {t("client.chat.empty.title", "No messages yet")}
          </Text>
          <Text style={styles.emptyBody}>
            {t(
              "client.chat.empty.body",
              "Start the conversation with your driver once your order is active."
            )}
          </Text>
          <Text style={styles.errorLine}>
            {t("client.chat.errors.missingOrder", "Commande introuvable.")}
          </Text>

          <TouchableOpacity onPress={safeBack} style={styles.backBtn} activeOpacity={0.85}>
            <Text style={styles.backBtnText}>
              {t("common.back", "Retour")}
            </Text>
          </TouchableOpacity>
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
    />
  );
}

export default ClientChatScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 10,
  },
  brand: {
    color: MMD_WHITE,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
  emptySub: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  emptyBody: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 320,
  },
  errorLine: {
    color: "#FCA5A5",
    fontWeight: "900",
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    marginTop: 8,
  },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: MMD_GREEN,
  },
  backBtnText: {
    color: MMD_TEXT,
    fontWeight: "900",
    fontFamily: MMD_FONT.extrabold,
  },
});
