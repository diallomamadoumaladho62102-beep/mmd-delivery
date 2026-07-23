import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  useWindowDimensions,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { ClientAdvertisement } from "../../../lib/clientAdvertisementsApi";
import {
  RESTAURANT_HOME_NAV,
  type RestaurantHomeNavKey,
} from "./restaurantHomeNav";
import { RestaurantSidebarAd } from "./RestaurantSidebarAd";
import { RH, RH_SIDEBAR_WIDTH, RH_SHADOW } from "./restaurantHomeTheme";

type BadgeCounts = {
  pendingOrders: number;
  ordersToday: number;
  drivers: number;
};

type Props = {
  permanent: boolean;
  open: boolean;
  onClose: () => void;
  activeKey: RestaurantHomeNavKey;
  showDrivers: boolean;
  showHeatmap: boolean;
  badges: BadgeCounts;
  ad: ClientAdvertisement | null;
  adLoading?: boolean;
  adCountry?: string | null;
  adLanguage?: string | null;
  onAdAction?: (ad: ClientAdvertisement) => void;
  onNavigate: (key: RestaurantHomeNavKey) => void;
  t: (key: string, fallback: string) => string;
};

function NavList({
  activeKey,
  showDrivers,
  showHeatmap,
  badges,
  onNavigate,
  t,
}: {
  activeKey: RestaurantHomeNavKey;
  showDrivers: boolean;
  showHeatmap: boolean;
  badges: BadgeCounts;
  onNavigate: (key: RestaurantHomeNavKey) => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {RESTAURANT_HOME_NAV.map((item) => {
        const selected = item.key === activeKey;
        const layerOn =
          (item.toggle === "drivers" && showDrivers) ||
          (item.toggle === "heatmap" && showHeatmap);

        let badgeValue: number | undefined;
        if (item.badge === "pendingOrders" && badges.pendingOrders > 0) {
          badgeValue = badges.pendingOrders;
        } else if (item.badge === "ordersToday" && badges.ordersToday > 0) {
          badgeValue = badges.ordersToday;
        } else if (item.badge === "drivers" && badges.drivers > 0) {
          badgeValue = badges.drivers;
        }

        return (
          <Pressable
            key={item.key}
            onPress={() => onNavigate(item.key)}
            style={[styles.navItem, selected && styles.navItemActive]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={t(item.labelKey, item.labelFallback)}
          >
            {selected ? <View style={styles.activeBar} /> : null}
            <Ionicons
              name={item.icon}
              size={18}
              color={selected ? RH.greenDark : RH.textSecondary}
            />
            <Text
              style={[styles.navLabel, selected && styles.navLabelActive]}
              numberOfLines={1}
            >
              {t(item.labelKey, item.labelFallback)}
            </Text>
            {item.toggle ? (
              <View style={[styles.layerDot, layerOn && styles.layerDotOn]} />
            ) : null}
            {badgeValue !== undefined ? (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>
                  {badgeValue > 99 ? "99+" : String(badgeValue)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function RestaurantHomeSidebar({
  permanent,
  open,
  onClose,
  activeKey,
  showDrivers,
  showHeatmap,
  badges,
  ad,
  adLoading,
  adCountry,
  adLanguage,
  onAdAction,
  onNavigate,
  t,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const body = (
    <View
      style={[
        styles.panel,
        permanent ? styles.panelPermanent : styles.panelDrawer,
        { paddingTop: permanent ? 8 : Math.max(insets.top, Platform.OS === "ios" ? 12 : 8), height: permanent ? "100%" : height },
      ]}
    >
      {!permanent ? (
        <View style={styles.drawerHeader}>
          <Text style={styles.drawerTitle} numberOfLines={1}>
            {t("restaurant.home.menu", "Menu")}
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={RH.text} />
          </Pressable>
        </View>
      ) : null}

      <NavList
        activeKey={activeKey}
        showDrivers={showDrivers}
        showHeatmap={showHeatmap}
        badges={badges}
        onNavigate={(key) => {
          onNavigate(key);
          if (!permanent) onClose();
        }}
        t={t}
      />

      <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        <RestaurantSidebarAd
          ad={ad}
          loading={adLoading}
          country={adCountry}
          language={adLanguage}
          onAction={onAdAction}
        />
      </View>
    </View>
  );

  if (permanent) {
    return <View style={styles.permanentWrap}>{body}</View>;
  }

  return (
    <Modal
      visible={open}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
    >
      <SafeAreaProvider>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={onClose}
            accessibilityLabel="Close menu"
          />
          <View style={styles.drawerWrap}>{body}</View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  permanentWrap: {
    width: RH_SIDEBAR_WIDTH,
    backgroundColor: RH.sidebarBg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: RH.border,
    ...RH_SHADOW,
  },
  panel: {
    backgroundColor: RH.sidebarBg,
    flex: 1,
  },
  panelPermanent: {},
  panelDrawer: {
    width: Math.min(RH_SIDEBAR_WIDTH + 12, 320),
    ...RH_SHADOW,
  },
  modalRoot: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  drawerWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: RH.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RH.muted,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 10, paddingBottom: 12, gap: 2 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    position: "relative",
    overflow: "hidden",
  },
  navItemActive: {
    backgroundColor: RH.accentSoft,
  },
  activeBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: RH.green,
  },
  navLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: RH.textSecondary,
  },
  navLabelActive: {
    color: RH.greenDark,
    fontWeight: "800",
  },
  navBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: RH.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  navBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  layerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RH.borderStrong,
  },
  layerDotOn: {
    backgroundColor: RH.green,
  },
});
