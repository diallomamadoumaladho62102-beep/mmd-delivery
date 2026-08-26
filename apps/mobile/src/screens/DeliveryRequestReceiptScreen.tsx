import React, { useCallback } from "react";
import { useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { EntityReceiptScreenBody } from "./EntityReceiptScreen";
import { fetchDeliveryRequestReceipt } from "../lib/deliveryReceiptApi";

export default function DeliveryRequestReceiptScreen() {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const deliveryRequestId = String(
    route.params?.deliveryRequestId ?? ""
  ).trim();
  const hideCustomerNav = route.params?.viewer === "driver";
  const fetchReceipt = useCallback(
    (id: string) => fetchDeliveryRequestReceipt(id),
    []
  );

  return (
    <EntityReceiptScreenBody
      entityId={deliveryRequestId}
      fetchReceipt={fetchReceipt}
      entityLabelKey="order.receipt.package"
      entityLabelFallback={t("order.receipt.package", "Package")}
      hideCustomerNav={hideCustomerNav}
    />
  );
}
