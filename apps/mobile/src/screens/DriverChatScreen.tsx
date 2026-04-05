// apps/mobile/src/screens/DriverChatScreen.tsx
import React from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";
import { useTranslation } from "react-i18next";

export function DriverChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const orderId: string = String(route?.params?.orderId ?? "");

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      onBack={() => navigation.goBack()}
      titlePrefix={t("driver.chat.titlePrefix", "Driver")}
    />
  );
}
