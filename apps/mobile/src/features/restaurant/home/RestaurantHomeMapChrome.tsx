import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  RESTAURANT_MAP_STATUS_FILTERS,
  type RestaurantMapStatusFilter,
} from "./restaurantHomeNav";
import { RH, RH_BOTTOM_SAFE, RH_SHADOW, RH_SHADOW_SOFT } from "./restaurantHomeTheme";

export type MapSelection =
  | {
      kind: "order";
      id: string;
      status: string | null;
      total: number | null;
      createdAt: string | null;
      distanceKm: number | null;
    }
  | {
      kind: "driver";
      id: string;
      distanceKm: number | null;
      updatedAt: string | null;
    }
  | {
      kind: "restaurant";
      id: string;
      name: string;
    };

type Props = {
  statusFilter: RestaurantMapStatusFilter;
  onChangeStatusFilter: (key: RestaurantMapStatusFilter) => void;
  selection: MapSelection | null;
  onCloseSelection: () => void;
  onOpenSelection?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  onToggleLayers: () => void;
  onRefresh: () => void;
  layersActive: boolean;
  refreshing: boolean;
  formatMoney: (amount: number | null) => string;
  statusLabel: (status: string | null) => string;
  t: (key: string, fallback: string) => string;
};

export function RestaurantHomeMapChrome({
  statusFilter,
  onChangeStatusFilter,
  selection,
  onCloseSelection,
  onOpenSelection,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onToggleLayers,
  onRefresh,
  layersActive,
  refreshing,
  formatMoney,
  statusLabel,
  t,
}: Props) {
  const insets = useSafeAreaInsets();
  const [filterOpen, setFilterOpen] = useState(false);

  const filterLabel = useMemo(() => {
    const row = RESTAURANT_MAP_STATUS_FILTERS.find((f) => f.key === statusFilter);
    return t(row?.labelKey ?? "restaurant.home.filter.all", row?.labelFallback ?? "Tous les statuts");
  }, [statusFilter, t]);

  return (
    <>
      <View style={[styles.filterWrap, { top: 12 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={styles.filterBtn}
          accessibilityRole="button"
          accessibilityLabel={filterLabel}
        >
          <Ionicons name="funnel-outline" size={15} color={RH.text} />
          <Text style={styles.filterText} numberOfLines={1}>
            {filterLabel}
          </Text>
          <Ionicons name="chevron-down" size={14} color={RH.textSoft} />
        </Pressable>
      </View>

      <View
        style={[
          styles.controls,
          { bottom: Math.max(insets.bottom, RH_BOTTOM_SAFE) + 12 },
        ]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={onRecenter}
          style={styles.controlBtn}
          accessibilityLabel={t("restaurant.home.map.recenter", "Recentrer")}
        >
          <Ionicons name="locate-outline" size={20} color={RH.text} />
        </Pressable>
        <View style={styles.zoomStack}>
          <Pressable
            onPress={onZoomIn}
            style={styles.zoomBtn}
            accessibilityLabel={t("restaurant.home.map.zoomIn", "Zoom +")}
          >
            <Ionicons name="add" size={22} color={RH.text} />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable
            onPress={onZoomOut}
            style={styles.zoomBtn}
            accessibilityLabel={t("restaurant.home.map.zoomOut", "Zoom −")}
          >
            <Ionicons name="remove" size={22} color={RH.text} />
          </Pressable>
        </View>
        <Pressable
          onPress={onToggleLayers}
          style={[styles.controlBtn, layersActive && styles.controlBtnActive]}
          accessibilityLabel={t("restaurant.home.map.layers", "Couches")}
        >
          <Ionicons name="layers-outline" size={20} color={layersActive ? RH.greenDark : RH.text} />
        </Pressable>
        <Pressable
          onPress={onRefresh}
          style={[styles.controlBtn, refreshing && { opacity: 0.6 }]}
          accessibilityLabel={t("restaurant.home.map.refresh", "Actualiser")}
        >
          <Ionicons name="refresh-outline" size={20} color={RH.text} />
        </Pressable>
      </View>

      {selection ? (
        <View
          style={[
            styles.selectionWrap,
            { bottom: Math.max(insets.bottom, RH_BOTTOM_SAFE) + 12 },
          ]}
        >
          <View style={styles.selectionCard}>
            <View style={styles.selectionTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.selectionKind} numberOfLines={1}>
                  {selection.kind === "order"
                    ? t("restaurant.home.selection.order", "Commande")
                    : selection.kind === "driver"
                      ? t("restaurant.home.selection.driver", "Livreur")
                      : t("restaurant.home.selection.restaurant", "Restaurant")}
                </Text>
                <Text style={styles.selectionTitle} numberOfLines={1}>
                  {selection.kind === "order"
                    ? `#${selection.id.slice(0, 8)}`
                    : selection.kind === "driver"
                      ? t("restaurant.home.selection.driverActive", "En livraison")
                      : selection.name}
                </Text>
              </View>
              <Pressable onPress={onCloseSelection} style={styles.closeSel} hitSlop={8}>
                <Ionicons name="close" size={18} color={RH.textSecondary} />
              </Pressable>
            </View>

            {selection.kind === "order" ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaChip} numberOfLines={1}>
                  {statusLabel(selection.status)}
                </Text>
                {selection.distanceKm != null ? (
                  <Text style={styles.metaChip} numberOfLines={1}>
                    {selection.distanceKm.toFixed(1).replace(".", ",")} km
                  </Text>
                ) : null}
                {selection.total != null ? (
                  <Text style={styles.metaChip} numberOfLines={1}>
                    {formatMoney(selection.total)}
                  </Text>
                ) : null}
                {selection.createdAt ? (
                  <Text style={styles.metaChip} numberOfLines={1}>
                    {new Date(selection.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                ) : null}
              </View>
            ) : selection.kind === "driver" ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaChip} numberOfLines={1}>
                  {t("restaurant.home.selection.inDelivery", "En livraison")}
                </Text>
                {selection.distanceKm != null ? (
                  <Text style={styles.metaChip} numberOfLines={1}>
                    {selection.distanceKm.toFixed(1).replace(".", ",")} km
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.metaRow}>
                <Text style={styles.metaChip} numberOfLines={1}>
                  {t("restaurant.home.selection.yourRestaurant", "Votre établissement")}
                </Text>
              </View>
            )}

            {selection.kind === "order" && onOpenSelection ? (
              <Pressable onPress={onOpenSelection} style={styles.openBtn}>
                <Text style={styles.openBtnText}>
                  {t("common.view", "Voir")}
                </Text>
                <Ionicons name="arrow-forward" size={14} color="#fff" />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <SafeAreaProvider>
          <View style={styles.filterBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => setFilterOpen(false)}
              accessibilityLabel="Close filter"
            />
            <View style={styles.filterSheet} accessibilityViewIsModal>
              <Text style={styles.filterSheetTitle}>
                {t("restaurant.home.filter.title", "Filtrer la carte")}
              </Text>
              <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
                {RESTAURANT_MAP_STATUS_FILTERS.map((row) => {
                  const selected = row.key === statusFilter;
                  return (
                    <Pressable
                      key={row.key}
                      onPress={() => {
                        onChangeStatusFilter(row.key);
                        setFilterOpen(false);
                      }}
                      style={[styles.filterOption, selected && styles.filterOptionActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[styles.filterOptionText, selected && styles.filterOptionTextActive]}
                      >
                        {t(row.labelKey, row.labelFallback)}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark" size={18} color={RH.greenDark} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    position: "absolute",
    right: 12,
    zIndex: 20,
    alignItems: "flex-end",
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: RH.surface,
    borderWidth: 1,
    borderColor: RH.border,
    ...RH_SHADOW_SOFT,
  },
  filterText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    color: RH.text,
  },
  controls: {
    position: "absolute",
    right: 12,
    zIndex: 20,
    gap: 8,
    alignItems: "center",
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: RH.surface,
    borderWidth: 1,
    borderColor: RH.border,
    alignItems: "center",
    justifyContent: "center",
    ...RH_SHADOW_SOFT,
  },
  controlBtnActive: {
    borderColor: RH.green,
    backgroundColor: RH.greenSoft,
  },
  zoomStack: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: RH.surface,
    borderWidth: 1,
    borderColor: RH.border,
    ...RH_SHADOW_SOFT,
  },
  zoomBtn: {
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomDivider: { height: StyleSheet.hairlineWidth, backgroundColor: RH.border },
  selectionWrap: {
    position: "absolute",
    left: 12,
    right: 68,
    zIndex: 25,
  },
  selectionCard: {
    borderRadius: 16,
    backgroundColor: RH.surface,
    borderWidth: 1,
    borderColor: RH.border,
    padding: 12,
    ...RH_SHADOW,
  },
  selectionTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  selectionKind: {
    fontSize: 10,
    fontWeight: "800",
    color: RH.green,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  selectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: RH.text,
    marginTop: 2,
  },
  closeSel: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RH.muted,
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  metaChip: {
    fontSize: 11,
    fontWeight: "700",
    color: RH.textSecondary,
    backgroundColor: RH.muted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  openBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: RH.green,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  openBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  filterBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    justifyContent: "center",
    padding: 24,
  },
  filterSheet: {
    backgroundColor: RH.surface,
    borderRadius: 18,
    padding: 16,
    maxHeight: "70%",
    zIndex: 2,
    ...RH_SHADOW,
  },
  filterSheetTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: RH.text,
    marginBottom: 10,
  },
  filterOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  filterOptionActive: { backgroundColor: RH.accentSoft },
  filterOptionText: { fontSize: 14, fontWeight: "600", color: RH.textSecondary },
  filterOptionTextActive: { color: RH.greenDark, fontWeight: "800" },
});
