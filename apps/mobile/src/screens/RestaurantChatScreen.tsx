// apps/mobile/src/screens/RestaurantChatScreen.tsx
import React, { useMemo } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { useSafeBackNavigation } from "../navigation/navigationBack";

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
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        edges={["bottom", "left", "right"]}
      >
        <ScreenHeader
          title={t("restaurants.chat.titlePrefix", "Restaurant")}
          fallbackRoute="RestaurantCommandCenter"
          variant="dark"
        />
        <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 16, marginTop: 24 }}>
          {t("restaurants.chat.errors.missingOrder", "Commande introuvable.")}
        </Text>

        <TouchableOpacity
          onPress={safeBack}
          style={{
            marginTop: 16,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: "#2563EB",
          }}
        >
          <Text style={{ color: "white", fontWeight: "900" }}>
            {t("common.back", "Retour")}
          </Text>
        </TouchableOpacity>
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

export default RestaurantChatScreen;
