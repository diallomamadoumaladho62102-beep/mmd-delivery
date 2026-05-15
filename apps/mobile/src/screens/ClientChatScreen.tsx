// apps/mobile/src/screens/ClientChatScreen.tsx
import React from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";

type ChatTargetRole = "restaurant" | "driver" | "admin" | "";

export function ClientChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();

  const orderId = String(route?.params?.orderId ?? "");
  const targetRole = String(route?.params?.targetRole ?? "") as ChatTargetRole;

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      targetRole={targetRole}
      onBack={() => navigation.goBack()}
      titlePrefix={t("client.chat.titlePrefix", "Client")}
    />
  );
}