// apps/mobile/src/screens/ClientChatScreen.tsx
import React from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";

export function ClientChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation(); // ✅ re-render on language change

  const orderId: string = String(route?.params?.orderId ?? "");

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      onBack={() => navigation.goBack()}
      titlePrefix={t("client.chat.titlePrefix", "Client")}
    />
  );
}
