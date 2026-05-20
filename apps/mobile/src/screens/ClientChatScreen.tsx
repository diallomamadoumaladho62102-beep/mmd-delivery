// apps/mobile/src/screens/ClientChatScreen.tsx
import React, { useMemo } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";

type ChatTargetRole = "restaurant" | "driver" | "admin";

function isValidTargetRole(value: unknown): value is ChatTargetRole {
  return value === "restaurant" || value === "driver" || value === "admin";
}

export function ClientChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();

  const orderId = String(route?.params?.orderId ?? "").trim();
  const rawTargetRole = route?.params?.targetRole;
  const targetRole: ChatTargetRole = isValidTargetRole(rawTargetRole)
    ? rawTargetRole
    : "admin";

  const titlePrefix = useMemo(() => {
    return t("client.chat.titlePrefix", "Client");
  }, [t]);

  if (!orderId) {
    return (
      <View style={{ flex: 1, backgroundColor: "#020617", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 16 }}>
          {t("client.chat.errors.missingOrder", "Commande introuvable.")}
        </Text>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "#2563EB" }}
        >
          <Text style={{ color: "white", fontWeight: "900" }}>
            {t("common.back", "Retour")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      targetRole={targetRole}
      onBack={() => navigation.goBack()}
      titlePrefix={titlePrefix}
    />
  );
}

export default ClientChatScreen;