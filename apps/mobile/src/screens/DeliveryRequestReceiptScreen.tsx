import React, { useCallback } from "react";
import { useRoute } from "@react-navigation/native";
import { EntityReceiptScreenBody } from "./EntityReceiptScreen";
import { fetchDeliveryRequestReceipt } from "../lib/deliveryReceiptApi";

export default function DeliveryRequestReceiptScreen() {
  const route = useRoute<any>();
  const deliveryRequestId = String(
    route.params?.deliveryRequestId ?? ""
  ).trim();
  const fetchReceipt = useCallback(
    (id: string) => fetchDeliveryRequestReceipt(id),
    []
  );

  return (
    <EntityReceiptScreenBody
      entityId={deliveryRequestId}
      fetchReceipt={fetchReceipt}
      entityLabelKey="order.receipt.package"
      entityLabelFallback="Package"
    />
  );
}
