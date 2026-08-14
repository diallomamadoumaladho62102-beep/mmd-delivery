import React, { useCallback } from "react";
import { useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { EntityReceiptScreenBody } from "./EntityReceiptScreen";
import { fetchFoodOrderReceipt } from "../lib/foodReceiptApi";

export default function FoodOrderReceiptScreen() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const orderId = String(route.params?.orderId ?? "").trim();
  const fetchReceipt = useCallback(
    (id: string) => fetchFoodOrderReceipt(id),
    []
  );

  return (
    <EntityReceiptScreenBody
      entityId={orderId}
      fetchReceipt={fetchReceipt}
      entityLabelKey="order.receipt.order"
      entityLabelFallback={t("order.receipt.order", "Order")}
    />
  );
}
