import React from "react";
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RH, RH_HEADER_HEIGHT, RH_SHADOW_SOFT } from "./restaurantHomeTheme";

type Props = {
  restaurantName: string;
  restaurantIdShort: string | null;
  logoUrl: string | null;
  initials: string;
  online: boolean;
  busy: boolean;
  availabilityLoading: boolean;
  notificationCount: number;
  compact: boolean;
  onPressMenu?: () => void;
  onPressStatus: () => void;
  onPressNotifications: () => void;
  onPressAccount: () => void;
  statusLabel: string;
  brandTitle: string;
  brandSubtitle: string;
};

export function RestaurantHomeHeader({
  restaurantName,
  restaurantIdShort,
  logoUrl,
  initials,
  online,
  busy,
  availabilityLoading,
  notificationCount,
  compact,
  onPressMenu,
  onPressStatus,
  onPressNotifications,
  onPressAccount,
  statusLabel,
  brandTitle,
  brandSubtitle,
}: Props) {
  const insets = useSafeAreaInsets();
  const statusColor = !online ? RH.offline : busy ? RH.busy : RH.online;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 12 : 6),
          minHeight: RH_HEADER_HEIGHT + Math.max(insets.top, Platform.OS === "ios" ? 12 : 6),
          paddingBottom: 8,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          {compact && onPressMenu ? (
            <Pressable
              onPress={onPressMenu}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Menu"
              hitSlop={8}
            >
              <Ionicons name="menu" size={22} color={RH.text} />
            </Pressable>
          ) : null}
          <View style={styles.brandBlock}>
            <Text style={styles.brandTitle} numberOfLines={1}>
              {brandTitle}
            </Text>
            <Text style={styles.brandSubtitle} numberOfLines={1}>
              {brandSubtitle}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={onPressStatus}
          disabled={availabilityLoading}
          style={[styles.statusPill, availabilityLoading && { opacity: 0.65 }]}
          accessibilityRole="button"
          accessibilityLabel={statusLabel}
        >
          {availabilityLoading ? (
            <ActivityIndicator size="small" color={statusColor} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          )}
          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {statusLabel}
          </Text>
          <Ionicons name="chevron-down" size={14} color={RH.textSecondary} />
        </Pressable>

        <View style={styles.right}>
          <Pressable
            onPress={onPressNotifications}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={RH.text} />
            {notificationCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {notificationCount > 99 ? "99+" : String(notificationCount)}
                </Text>
              </View>
            ) : null}
          </Pressable>

          <Pressable
            onPress={onPressAccount}
            style={styles.account}
            accessibilityRole="button"
            accessibilityLabel={restaurantName}
          >
            <View style={styles.avatar}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.avatarImg} resizeMode="cover" />
              ) : (
                <Text style={styles.avatarInitials}>{initials.slice(0, 1)}</Text>
              )}
            </View>
            {!compact ? (
              <View style={styles.accountMeta}>
                <Text style={styles.accountName} numberOfLines={1}>
                  {restaurantName}
                </Text>
                {restaurantIdShort ? (
                  <Text style={styles.accountId} numberOfLines={1}>
                    ID: {restaurantIdShort}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Ionicons name="chevron-down" size={14} color={RH.textSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: RH.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RH.border,
    paddingHorizontal: 12,
    paddingBottom: 8,
    zIndex: 40,
    ...RH_SHADOW_SOFT,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "30%",
  },
  brandBlock: { minWidth: 0, flexShrink: 1 },
  brandTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: RH.greenDark,
    letterSpacing: 0.3,
  },
  brandSubtitle: {
    fontSize: 8,
    fontWeight: "800",
    color: RH.green,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 1,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: RH.muted,
    borderWidth: 1,
    borderColor: RH.border,
    flexShrink: 1,
    maxWidth: 140,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3, flexShrink: 1 },
  right: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginLeft: "auto",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RH.muted,
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: RH.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 4,
    borderRadius: 14,
    maxWidth: 200,
    minWidth: 0,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: RH.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: RH.green,
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitials: { color: RH.greenDark, fontWeight: "900", fontSize: 14 },
  accountMeta: { minWidth: 0, flexShrink: 1, maxWidth: 110 },
  accountName: { fontSize: 12, fontWeight: "800", color: RH.text },
  accountId: { fontSize: 9, fontWeight: "600", color: RH.textSoft, marginTop: 1 },
});
