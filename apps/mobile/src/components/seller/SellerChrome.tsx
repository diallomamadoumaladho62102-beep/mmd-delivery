import React from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useSafeBackNavigation } from "../../navigation/navigationBack";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

export type SellerNavKey = "home" | "orders" | "earnings" | "products" | "profile";

type BrandHeaderProps = {
  subtitle: string;
  showBack?: boolean;
  fallbackRoute?: "SellerDashboard" | "SellerGate";
  rightSlot?: React.ReactNode;
  style?: ViewStyle;
};

/** Figma Seller * headers — logo + MMD Delivery gold + screen subtitle. */
export function SellerBrandHeader({
  subtitle,
  showBack = false,
  fallbackRoute = "SellerDashboard",
  rightSlot,
  style,
}: BrandHeaderProps) {
  const insets = useSafeAreaInsets();
  const safeBack = useSafeBackNavigation(fallbackRoute);

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }, style]}>
      {showBack ? (
        <TouchableOpacity
          onPress={safeBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.brandRow}>
        <Image
          source={MMD_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />
        <View style={styles.titleBlock}>
          <Text style={styles.brandTitle}>MMD Delivery</Text>
          <Text style={styles.brandSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
    </View>
  );
}

type GlassCardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

export function SellerGlassCard({ children, style }: GlassCardProps) {
  return <View style={[styles.glassCard, style]}>{children}</View>;
}

type FeedbackProps = {
  title: string;
  message?: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionTone?: "green" | "red" | "gold";
};

/** Centered frosted loading / empty / error card (Figma Seller states). */
export function SellerFeedbackCard({
  title,
  message,
  icon,
  actionLabel,
  onAction,
  actionTone = "green",
  loading,
}: FeedbackProps & { loading?: boolean }) {
  const actionBg =
    actionTone === "red" ? "#EF4444" : actionTone === "gold" ? MMD_GOLD_CLASSIC : MMD_TAXI_GREEN;

  return (
    <View style={styles.feedbackWrap}>
      <SellerGlassCard style={styles.feedbackCard}>
        {loading ? (
          <ActivityIndicator color={MMD_GOLD_CLASSIC} size="large" style={{ marginVertical: 16 }} />
        ) : icon ? (
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>{icon}</Text>
          </View>
        ) : null}
        <Text style={styles.feedbackTitle}>{title}</Text>
        {message ? <Text style={styles.feedbackMessage}>{message}</Text> : null}
        {actionLabel && onAction ? (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: actionBg }]}
            onPress={onAction}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.actionLabel,
                actionTone === "gold" ? { color: MMD_BLUE } : null,
              ]}
            >
              {actionLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </SellerGlassCard>
    </View>
  );
}

type BottomNavProps = {
  active: SellerNavKey;
};

const NAV_ITEMS: Array<{
  key: SellerNavKey;
  icon: string;
  label: string;
  route: string;
  params?: Record<string, unknown>;
}> = [
  { key: "home", icon: "🏠", label: "Home", route: "SellerDashboard" },
  { key: "orders", icon: "📦", label: "Orders", route: "SellerOrders" },
  { key: "earnings", icon: "💰", label: "Earnings", route: "SellerWallet" },
  { key: "products", icon: "🛍️", label: "Products", route: "SellerProducts" },
  {
    key: "profile",
    icon: "👤",
    label: "Profile",
    route: "SellerOnboarding",
    params: { mode: "edit" },
  },
];

/** Seller stack bottom nav — Figma chrome wired to real seller routes. */
export function SellerBottomNav({ active }: BottomNavProps) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {NAV_ITEMS.map((item) => {
        const selected = item.key === active;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.navItem}
            onPress={() => {
              if (selected) return;
              if (item.params) {
                navigation.navigate(item.route, item.params);
              } else {
                navigation.navigate(item.route);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.navIcon, selected && styles.navIconActive]}>{item.icon}</Text>
            <Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: MMD_BLUE,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginTop: -2,
  },
  brandRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  brandTitle: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 18,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  brandSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  rightSlot: { minWidth: 44, alignItems: "flex-end" },
  glassCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 24,
    padding: 20,
  },
  feedbackWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  feedbackCard: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    gap: 12,
    padding: 40,
    borderRadius: 28,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: { fontSize: 40 },
  feedbackTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  feedbackMessage: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 21,
  },
  actionBtn: {
    marginTop: 8,
    width: "100%",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  actionLabel: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
  },
  navItem: { flex: 1, alignItems: "center", gap: 4 },
  navIcon: { fontSize: 20, color: "rgba(255,255,255,0.7)" },
  navIconActive: { color: MMD_GOLD_CLASSIC },
  navLabel: {
    fontSize: 10,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.7)",
  },
  navLabelActive: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});
