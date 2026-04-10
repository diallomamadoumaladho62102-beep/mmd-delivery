// apps/mobile/src/screens/RestaurantChatScreen.tsx
import React, { useMemo } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { OrderChatBaseScreen } from "./_shared/OrderChatBase";

export function RestaurantChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();

  const orderId: string = String(route?.params?.orderId ?? "");

  // ✅ Re-render auto quand la langue change
  const titlePrefix = useMemo(() => {
    return t("restaurants.chat.titlePrefix", "Restaurant");
  }, [t]);

  return (
    <OrderChatBaseScreen
      orderId={orderId}
      onBack={() => navigation.goBack()}
      titlePrefix={titlePrefix}
    />
  );
}
