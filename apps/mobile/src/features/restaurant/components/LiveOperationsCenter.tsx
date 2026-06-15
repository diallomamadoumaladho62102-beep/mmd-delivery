import React, { memo, useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type {
  CommandCenterAttentionCard,
  CommandCenterDriverCard,
  CommandCenterNewOrderCard,
  RestaurantCommandCenterData,
} from "../../../lib/restaurantCommandCenterApi";
import {
  postRestaurantOrderReject,
  postRestaurantOrderStatus,
} from "../../../lib/restaurantOrderStatusApi";
import { formatMoney } from "../../../i18n/formatters";
import { textAlignStart } from "../../../i18n/rtl";
import { DriverArrivalCard } from "./DriverArrivalCard";

type Props = {
  data: RestaurantCommandCenterData["liveOperations"];
  currency: string;
  language: string;
  onHandOver: (orderId: string) => void;
  onViewMap: (orderId: string) => void;
  onViewOrder: (orderId: string) => void;
  onRefresh: () => void;
};

function NewOrderCard({
  order,
  currency,
  language,
  onAccept,
  onReject,
  loading,
}: {
  order: CommandCenterNewOrderCard;
  currency: string;
  language: string;
  onAccept: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View style={[styles.card, { borderColor: "rgba(167,139,250,0.45)" }]}>
      <Text style={styles.badge}>{t("restaurant.commandCenter.newOrder")}</Text>
      <Text style={styles.orderLabel}>{order.orderLabel}</Text>
      <Text style={[styles.meta, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.newOrderMeta", {
          seconds: order.receivedSecondsAgo,
          count: order.itemCount,
          amount: formatMoney(order.totalAmount, order.currency || currency, language),
        })}
      </Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.acceptBtn, loading && styles.btnDisabled]}
          onPress={onAccept}
          disabled={loading}
        >
          <Text style={styles.acceptText}>{t("restaurant.commandCenter.accept")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rejectBtn, loading && styles.btnDisabled]}
          onPress={onReject}
          disabled={loading}
        >
          <Text style={styles.rejectText}>{t("restaurant.commandCenter.reject")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AttentionCard({
  card,
  onPress,
}: {
  card: CommandCenterAttentionCard;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: "rgba(239,68,68,0.45)" }]}
      onPress={onPress}
    >
      <Text style={styles.badge}>{t("restaurant.commandCenter.attentionRequired")}</Text>
      <Text style={styles.orderLabel}>{card.orderLabel}</Text>
      <Text style={[styles.meta, { textAlign: textAlignStart() }]}>
        {t(card.reasonKey, card.reasonParams)}
      </Text>
      <Text style={styles.link}>{t("restaurant.commandCenter.viewOrder")}</Text>
    </TouchableOpacity>
  );
}

function LiveOperationsCenterComponent({
  data,
  currency,
  language,
  onHandOver,
  onViewMap,
  onViewOrder,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const handleAccept = useCallback(
    async (orderId: string) => {
      try {
        setActionLoadingId(orderId);
        await postRestaurantOrderStatus({ orderId, status: "accepted" });
        onRefresh();
      } catch (e: unknown) {
        Alert.alert(
          t("common.errorTitle"),
          e instanceof Error ? e.message : t("restaurant.commandCenter.actionFailed")
        );
      } finally {
        setActionLoadingId(null);
      }
    },
    [onRefresh, t]
  );

  const handleReject = useCallback(
    (orderId: string) => {
      Alert.alert(
        t("restaurant.commandCenter.rejectTitle"),
        t("restaurant.commandCenter.rejectConfirm"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("restaurant.commandCenter.reject"),
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  setActionLoadingId(orderId);
                  await postRestaurantOrderReject({ orderId });
                  onRefresh();
                } catch (e: unknown) {
                  Alert.alert(
                    t("common.errorTitle"),
                    e instanceof Error ? e.message : t("restaurant.commandCenter.actionFailed")
                  );
                } finally {
                  setActionLoadingId(null);
                }
              })();
            },
          },
        ]
      );
    },
    [onRefresh, t]
  );

  const cards: Array<
    | { kind: "driver"; variant: "arrived" | "approaching" | "en_route"; card: CommandCenterDriverCard }
    | { kind: "new"; card: CommandCenterNewOrderCard }
    | { kind: "attention"; card: CommandCenterAttentionCard }
  > = [
    ...data.driverArrived.map((card) => ({ kind: "driver" as const, variant: "arrived" as const, card })),
    ...data.driverApproaching.map((card) => ({
      kind: "driver" as const,
      variant: "approaching" as const,
      card,
    })),
    ...data.driverEnRoute.map((card) => ({ kind: "driver" as const, variant: "en_route" as const, card })),
    ...data.newOrders.map((card) => ({ kind: "new" as const, card })),
    ...data.attentionRequired.map((card) => ({ kind: "attention" as const, card })),
  ];

  if (cards.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.sectionTitle}>{t("restaurant.commandCenter.liveOperations")}</Text>
        <Text style={styles.emptyText}>{t("restaurant.commandCenter.liveOperationsEmpty")}</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.sectionTitle}>{t("restaurant.commandCenter.liveOperations")}</Text>
      <FlatList
        horizontal
        data={cards}
        keyExtractor={(item, index) => {
          if (item.kind === "driver") return `driver-${item.card.orderId}-${item.variant}`;
          if (item.kind === "new") return `new-${item.card.orderId}`;
          return `attention-${item.card.orderId}-${index}`;
        }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => {
          if (item.kind === "driver") {
            return (
              <DriverArrivalCard
                card={item.card}
                variant={item.variant}
                onHandOver={
                  item.variant === "arrived"
                    ? () => onHandOver(item.card.orderId)
                    : undefined
                }
                onViewMap={
                  item.variant !== "arrived"
                    ? () => onViewMap(item.card.orderId)
                    : undefined
                }
              />
            );
          }

          if (item.kind === "new") {
            return (
              <NewOrderCard
                order={item.card}
                currency={currency}
                language={language}
                loading={actionLoadingId === item.card.orderId}
                onAccept={() => void handleAccept(item.card.orderId)}
                onReject={() => handleReject(item.card.orderId)}
              />
            );
          }

          return (
            <AttentionCard
              card={item.card}
              onPress={() => onViewOrder(item.card.orderId)}
            />
          );
        }}
      />
    </View>
  );
}

export const LiveOperationsCenter = memo(LiveOperationsCenterComponent);

const styles = StyleSheet.create({
  sectionTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 12,
  },
  emptyWrap: {
    marginBottom: 8,
  },
  emptyText: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 13,
  },
  card: {
    width: 260,
    marginRight: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  badge: {
    color: "#F8FAFC",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  orderLabel: {
    color: "#DDD6FE",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 6,
  },
  meta: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    marginBottom: 10,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: "rgba(124,58,237,0.85)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  acceptText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 13,
  },
  rejectText: {
    color: "#FCA5A5",
    fontWeight: "800",
    fontSize: 13,
  },
  link: {
    color: "#A78BFA",
    fontWeight: "800",
    fontSize: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
