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
import { rowDirection, textAlignStart } from "../../../i18n/rtl";
import { DriverArrivalCard } from "./DriverArrivalCard";
import { GlassCard } from "./GlassCard";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { CC, LIVE_OPS_STATUS, liveOpsCardStyle } from "./commandCenterTheme";

type Props = {
  data: RestaurantCommandCenterData["liveOperations"];
  currency: string;
  language: string;
  onHandOver: (orderId: string) => void;
  onViewMap: (orderId: string) => void;
  onViewOrder: (orderId: string) => void;
  onRefresh: () => void;
};

const LEGEND_ITEMS = [
  { key: "arrived", labelKey: "restaurant.commandCenter.driverArrived" },
  { key: "approaching", labelKey: "restaurant.commandCenter.driverApproaching" },
  { key: "en_route", labelKey: "restaurant.commandCenter.driverEnRoute" },
  { key: "new_order", labelKey: "restaurant.commandCenter.newOrder" },
  { key: "attention", labelKey: "restaurant.commandCenter.attentionRequired" },
] as const;

function StatusLegend() {
  const { t } = useTranslation();

  return (
    <View style={[styles.legendRow, { flexDirection: rowDirection() }]}>
      {LEGEND_ITEMS.map((item) => {
        const status = LIVE_OPS_STATUS[item.key];
        return (
          <View key={item.key} style={styles.legendItem}>
            <Text style={styles.legendDot}>{status.dot}</Text>
            <Text style={styles.legendText} numberOfLines={1}>
              {t(item.labelKey)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

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
  const status = LIVE_OPS_STATUS.new_order;

  return (
    <View style={liveOpsCardStyle("new_order")}>
      <View style={[styles.statusHeader, { flexDirection: rowDirection() }]}>
        <Text style={styles.statusDot}>{status.dot}</Text>
        <View style={[styles.statusChip, { backgroundColor: status.tint, borderColor: status.border }]}>
          <Text style={[styles.statusChipText, { color: status.color }]}>
            {t("restaurant.commandCenter.newOrder")}
          </Text>
        </View>
      </View>
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
  const status = LIVE_OPS_STATUS.attention;

  return (
    <TouchableOpacity style={liveOpsCardStyle("attention")} onPress={onPress} activeOpacity={0.88}>
      <View style={[styles.statusHeader, { flexDirection: rowDirection() }]}>
        <Text style={styles.statusDot}>{status.dot}</Text>
        <View style={[styles.statusChip, { backgroundColor: status.tint, borderColor: status.border }]}>
          <Text style={[styles.statusChipText, { color: status.color }]}>
            {t("restaurant.commandCenter.attentionRequired")}
          </Text>
        </View>
      </View>
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

  const liveCount = cards.length;

  const content =
    cards.length === 0 ? (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>{t("restaurant.commandCenter.liveOperationsEmpty")}</Text>
      </View>
    ) : (
      <FlatList
        horizontal
        data={cards}
        keyExtractor={(item, index) => {
          if (item.kind === "driver") return `driver-${item.card.orderId}-${item.variant}`;
          if (item.kind === "new") return `new-${item.card.orderId}`;
          return `attention-${item.card.orderId}-${index}`;
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
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
    );

  return (
    <GlassCard variant="hero" accentBar={CC.purpleLight} style={styles.heroCard}>
      <SectionHeroHeader
        title={t("restaurant.commandCenter.liveOperations")}
        subtitle={t("restaurant.commandCenter.liveOperationsHero")}
        badge={liveCount > 0 ? String(liveCount) : undefined}
        badgeColor={CC.red}
      />
      <StatusLegend />
      {content}
    </GlassCard>
  );
}

export const LiveOperationsCenter = memo(LiveOperationsCenterComponent);

const styles = StyleSheet.create({
  heroCard: {
    paddingBottom: 14,
    borderColor: CC.purpleGlow,
    borderWidth: 1.5,
  },
  legendRow: {
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  legendDot: {
    fontSize: 10,
  },
  legendText: {
    color: CC.textMuted,
    fontSize: 9,
    fontWeight: "800",
    maxWidth: 88,
  },
  listContent: {
    paddingRight: 8,
    paddingTop: 4,
  },
  emptyWrap: {
    paddingVertical: 16,
    alignItems: "center",
  },
  emptyText: {
    color: CC.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  statusHeader: {
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  statusDot: {
    fontSize: 14,
  },
  statusChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  orderLabel: {
    color: CC.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  meta: {
    color: CC.textMuted,
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: CC.purple,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    ...CC.shadow,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: CC.redDim,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.45)",
  },
  acceptText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 14,
  },
  rejectText: {
    color: "#FCA5A5",
    fontWeight: "900",
    fontSize: 14,
  },
  link: {
    color: CC.purpleLight,
    fontWeight: "900",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
