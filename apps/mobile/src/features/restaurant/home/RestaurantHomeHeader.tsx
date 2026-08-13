import React from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MMD_FONT } from "../../../theme/mmdUi";
import { RH, RH_HEADER_HEIGHT } from "./restaurantHomeTheme";

const MMD_LOGO = require("../../../../assets/brand/mmd-logo-ui.png");

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
          paddingTop: Math.max(insets.top, Platform.OS === "ios" ? 14 : 8),
          minHeight: RH_HEADER_HEIGHT + Math.max(insets.top, Platform.OS === "ios" ? 14 : 8),
        },
      ]}
    >
      <View style={styles.row}>
        {compact && onPressMenu ? (
          <Pressable
            onPress={onPressMenu}
            style={styles.logoBtn}
            accessibilityRole="button"
            accessibilityLabel="Menu"
            hitSlop={8}
          >
            <Image source={MMD_LOGO} style={styles.logo} resizeMode="contain" />
          </Pressable>
        ) : (
          <View style={styles.logoBtn}>
            <Image source={MMD_LOGO} style={styles.logo} resizeMode="contain" />
          </View>
        )}

        <View style={styles.brandBlock}>
          <Text style={styles.brandTitle} numberOfLines={1}>
            {brandTitle}
          </Text>
          <Text style={styles.brandSubtitle} numberOfLines={1}>
            {brandSubtitle}
          </Text>
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
          <Text style={styles.chevron}>▾</Text>
        </Pressable>

        <Pressable
          onPress={onPressNotifications}
          style={styles.notifBtn}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
        >
          <Ionicons name="notifications" size={18} color={RH.brandGold} />
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
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.avatarImg} resizeMode="cover" />
          ) : initials ? (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials.slice(0, 1)}</Text>
            </View>
          ) : (
            <Image source={MMD_LOGO} style={styles.avatarImg} resizeMode="contain" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: RH.surface,
    borderBottomWidth: 1,
    borderBottomColor: RH.border,
    paddingHorizontal: 12,
    paddingBottom: 8,
    zIndex: 40,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
  },
  logoBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    overflow: "hidden",
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  brandBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  brandTitle: {
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: RH.brandGold,
  },
  brandSubtitle: {
    fontSize: 10,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    color: RH.textSecondary,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: RH.muted,
    borderWidth: 1,
    borderColor: RH.borderStrong,
    flexShrink: 0,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: {
    fontSize: 11,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  chevron: {
    fontSize: 10,
    color: RH.textSecondary,
    fontFamily: MMD_FONT.regular,
  },
  notifBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: RH.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: RH.white,
    fontSize: 9,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  account: {
    width: 32,
    height: 32,
    borderRadius: 8,
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%", borderRadius: 8 },
  avatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: RH.muted,
  },
  avatarInitials: {
    color: RH.brandGold,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
});
