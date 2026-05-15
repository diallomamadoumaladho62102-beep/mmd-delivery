// apps/mobile/src/screens/DriverChatScreen.tsx
import React from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";
import { useTranslation } from "react-i18next";

type ChatTargetRole = "client" | "restaurant" | "admin" | "";

export function DriverChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const orderId = String(route?.params?.orderId ?? "");
  const targetRole = String(route?.params?.targetRole ?? "") as ChatTargetRole;

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      targetRole={targetRole}
      onBack={() => navigation.goBack()}
      titlePrefix={t("driver.chat.titlePrefix", "Driver")}
    />
  );
}