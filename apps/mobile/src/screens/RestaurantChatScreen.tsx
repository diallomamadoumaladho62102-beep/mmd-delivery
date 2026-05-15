// apps/mobile/src/screens/RestaurantChatScreen.tsx
import React, { useMemo } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";

type ChatTargetRole = "client" | "driver" | "admin" | "";

export function RestaurantChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();

  const orderId = String(route?.params?.orderId ?? "");
  const targetRole = String(route?.params?.targetRole ?? "") as ChatTargetRole;

  const titlePrefix = useMemo(() => {
    return t("restaurants.chat.titlePrefix", "Restaurant");
  }, [t]);

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      targetRole={targetRole}
      onBack={() => navigation.goBack()}
      titlePrefix={titlePrefix}
    />
  );
}