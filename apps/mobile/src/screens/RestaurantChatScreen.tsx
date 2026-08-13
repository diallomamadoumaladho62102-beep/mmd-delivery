// apps/mobile/src/screens/RestaurantChatScreen.tsx
import React, { useMemo } from "react";
import {
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
import { useSafeBackNavigation } from "../navigation/navigationBack";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_WHITE,
} from "../theme/mmdUi";

type ChatTargetRole = "client" | "driver" | "admin";

function isValidTargetRole(value: unknown): value is ChatTargetRole {
  return value === "client" || value === "driver" || value === "admin";
}

export function RestaurantChatScreen() {
  const route = useRoute<any>();
  const { t } = useTranslation();
  const safeBack = useSafeBackNavigation("RestaurantCommandCenter");

  const orderId = String(route?.params?.orderId ?? "").trim();
  const rawTargetRole = route?.params?.targetRole;
  const sourceTable = route?.params?.sourceTable ?? route?.params?.source_table;
  const targetRole: ChatTargetRole = isValidTargetRole(rawTargetRole)
    ? rawTargetRole
    : "admin";

  const titlePrefix = useMemo(() => {
    return t("restaurants.chat.titlePrefix", "Restaurant");
  }, [t]);

  if (!orderId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <View style={styles.center}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Text style={styles.icon}>❌</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>
                {t("restaurants.chat.missing.title", "Order Not Found")}
              </Text>
              <Text style={styles.body}>
                {t(
                  "restaurants.chat.missing.body",
                  "This order could not be found."
                )}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={safeBack}
            style={styles.goBack}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={t("common.back", "Go Back")}
          >
            <Text style={styles.goBackText}>
              {t("restaurants.chat.missing.goBack", "Go Back")}
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
      appearance="restaurant"
    />
  );
}

export default RestaurantChatScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 24,
  },
  card: {
    width: 320,
    maxWidth: "100%",
    borderRadius: 24,
    padding: 24,
    gap: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  icon: { fontSize: 24 },
  copy: { gap: 8 },
  title: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  body: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  goBack: {
    backgroundColor: MMD_WHITE,
    borderRadius: 100,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goBackText: {
    color: MMD_BLUE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
