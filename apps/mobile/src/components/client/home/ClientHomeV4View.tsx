import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
  FlatList,
  Dimensions,
  Animated,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { AppLanguageCode } from "../../../i18n/languageOptions";
import type { PlatformFeaturesResponse } from "../../../lib/platformFeaturesApi";
import type { ClientAdvertisement } from "../../../lib/clientAdvertisementsApi";
import { ClientHomeLanguageSheet } from "./ClientHomeLanguageSheet";
import { V4, V4_SHADOW, V4_SHADOW_SOFT, v4Styles } from "./clientHomeTheme";

export type ClientHomeItem = {
  id: string;
  kind: "restaurant_order" | "delivery_request" | "taxi_ride";
  status: string;
  payment_status: string | null;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  total: number | null;
  delivery_fee: number | null;
};

type TsFn = (key: string, fallback: string, params?: Record<string, unknown>) => string;

export type ClientHomeV4ViewProps = {
  ts: TsFn;
  loading: boolean;
  refreshing: boolean;
  items: ClientHomeItem[];
  error: { key: string; fallback: string; params?: Record<string, unknown> } | null;
  recentActivityUnavailable: boolean;
  avatarUrl: string | null;
  initials: string;
  firstName: string;
  greeting: string;
  displayLocation: string;
  spendingAmount: string | null;
  activeOrdersCount: number;
  platformFeatures: PlatformFeaturesResponse;
  comingSoonLabel: string;
  marketplaceSoonLabel: string;
  scopeLabel: string | null;
  showUseCurrentLocation: boolean;
  areaLabel: string | null;
  stats: {
    points: number;
    level: string;
    nextLevelTarget: number;
    inProgress: number;
    delivered: number;
    conversionLabel?: string;
    pointsToNext?: number;
    creditLabel?: string;
  };
  progressBarWidth: `${number}%`;
  menuOpen: boolean;
  currentLang: string;
  advertisements: ClientAdvertisement[];
  onAdImpression: (adId: string) => void;
  onAdClick: (ad: ClientAdvertisement) => void;
  onRefresh: () => void;
  onRefreshLocation: () => void;
  onChangeLang: (lang: AppLanguageCode) => void;
  onCloseMenu: () => void;
  onToggleMenu: () => void;
  onSignOut: () => void;
  onSwitchRole: () => void;
  onNavigateTaxi: () => void;
  onNavigateFood: () => void;
  onNavigateDelivery: () => void;
  onNavigateMarketplace: () => void;
  onNavigateInbox: () => void;
  onNavigateProfile: () => void;
  onNavigateOrders: () => void;
  onNavigateRewards: () => void;
  onNavigateMmdPlus: () => void;
  onNavigateAi: () => void;
  onNavigateWallet?: () => void;
  onOpenOrder: (item: ClientHomeItem) => void;
  onOpenChat: (orderId: string) => void;
  formatCurrency: (amount: number | null | undefined) => string;
  formatCompactDateTime: (iso: string | null) => string;
  recentTitle: (item: ClientHomeItem) => string;
  statusLabel: (item: ClientHomeItem) => string;
};

const SCREEN_W = Dimensions.get("window").width;
const AD_CARD_W = Math.min(188, SCREEN_W * 0.48);
const AD_GAP = 10;
const AD_CARD_H = 168;

const SERVICE_ART = {
  taxi: require("../../../../assets/brand/services/taxi-mmd-official.png"),
  food: require("../../../../assets/brand/services/food.png"),
  delivery: require("../../../../assets/brand/services/delivery-mmd-v2.png"),
  marketplace: require("../../../../assets/brand/services/marketplace.png"),
} as const;

const LANGUAGE_GLOBE_ICON = require("../../../../assets/brand/icons/language-globe-v3.png");

function PressCard({
  children,
  onPress,
  disabled,
  style,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: object;
  testID?: string;
}) {
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        style,
        pressed && !disabled ? { opacity: 0.9, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.48 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

function serviceMeta(kind: ClientHomeItem["kind"]): { badge: string; color: string; bg: string } {
  if (kind === "taxi_ride") return { badge: "TX", color: V4.taxi, bg: V4.yellowSoft };
  if (kind === "delivery_request") return { badge: "DL", color: V4.delivery, bg: V4.purpleSoft };
  return { badge: "FD", color: V4.food, bg: V4.greenSoft };
}

function statusTone(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("cancel") || lower.includes("annul")) return V4.danger;
  if (lower.includes("complet") || lower.includes("deliver") || lower.includes("livré")) {
    return V4.green;
  }
  return V4.textSecondary;
}

export function ClientHomeV4View(props: ClientHomeV4ViewProps) {
  const insets = useSafeAreaInsets();
  const [adIndex, setAdIndex] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const impressed = useRef(new Set<string>());
  const aiPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setAvatarFailed(false);
  }, [props.avatarUrl]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(aiPulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(aiPulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [aiPulse]);

  const aiScale = aiPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const showAvatarPhoto = Boolean(props.avatarUrl) && !avatarFailed;

  const openSearchHub = useCallback(() => {
    Alert.alert(
      props.ts("client.home.search.title", "Search MMD"),
      props.ts(
        "client.home.search.subtitle",
        "Where do you want to go or what do you need?",
      ),
      [
        { text: props.ts("client.home.services.taxi", "Taxi"), onPress: props.onNavigateTaxi },
        { text: props.ts("client.home.services.food", "Food"), onPress: props.onNavigateFood },
        {
          text: props.ts("client.home.services.delivery", "Delivery"),
          onPress: props.onNavigateDelivery,
        },
        {
          text: props.ts("client.home.services.marketplace", "Marketplace"),
          onPress: props.onNavigateMarketplace,
        },
        { text: props.ts("shared.cancel", "Cancel"), style: "cancel" },
      ],
    );
  }, [props]);

  const onAdViewable = useCallback(
    (index: number) => {
      const ad = props.advertisements[index];
      if (!ad) return;
      if (impressed.current.has(ad.id)) return;
      impressed.current.add(ad.id);
      props.onAdImpression(ad.id);
    },
    [props],
  );

  useEffect(() => {
    if (props.advertisements[0]) onAdViewable(0);
  }, [props.advertisements, onAdViewable]);

  const onAdsScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / (AD_CARD_W + AD_GAP));
      const clamped = Math.max(0, Math.min(idx, props.advertisements.length - 1));
      setAdIndex(clamped);
      onAdViewable(clamped);
    },
    [onAdViewable, props.advertisements.length],
  );

  const creditLabel = props.stats.creditLabel ?? "$0.00";
  const pointsToNext = props.stats.pointsToNext ?? props.stats.nextLevelTarget;
  const progressLabel = `${Math.round(props.stats.points).toLocaleString()} / ${Math.max(
    1,
    Math.round(props.stats.points + (pointsToNext || 0)),
  ).toLocaleString()} pts until ${props.stats.level === "Bronze" ? "Silver" : "next"} tier`;

  const services = useMemo(
    () => [
      {
        key: "taxi" as const,
        badge: "TX",
        badgeBg: V4.yellowSoft,
        badgeFg: V4.taxi,
        title: props.ts("client.home.services.taxi", "Taxi"),
        subtitle: props.ts("client.home.services.taxiSub", "Ride anywhere"),
        art: SERVICE_ART.taxi,
        accent: V4.taxi,
        enabled: props.platformFeatures.taxi_available !== false,
        onPress: props.onNavigateTaxi,
      },
      {
        key: "food" as const,
        badge: "FD",
        badgeBg: V4.greenSoft,
        badgeFg: V4.food,
        title: props.ts("client.home.services.food", "Food"),
        subtitle: props.ts("client.home.services.foodSub", "Order now"),
        art: SERVICE_ART.food,
        accent: V4.food,
        enabled: props.platformFeatures.restaurant_available !== false,
        onPress: props.onNavigateFood,
      },
      {
        key: "delivery" as const,
        badge: "DL",
        badgeBg: V4.purpleSoft,
        badgeFg: V4.delivery,
        title: props.ts("client.home.services.delivery", "Delivery"),
        subtitle: props.ts("client.home.services.deliverySub", "Send anything"),
        art: SERVICE_ART.delivery,
        accent: V4.delivery,
        enabled: props.platformFeatures.delivery_available !== false,
        onPress: props.onNavigateDelivery,
      },
      {
        key: "marketplace" as const,
        badge: "MK",
        badgeBg: "#D1FAE5",
        badgeFg: V4.marketplace,
        title: props.ts("client.home.services.marketplace", "Marketplace"),
        subtitle: props.ts("client.home.services.marketplaceSub", "Shop & save"),
        art: SERVICE_ART.marketplace,
        accent: V4.marketplace,
        enabled: props.platformFeatures.marketplace_available !== false,
        onPress: props.onNavigateMarketplace,
      },
    ],
    [props],
  );

  if (props.loading && props.items.length === 0 && !props.refreshing) {
    return (
      <View style={[v4Styles.root, styles.centered]}>
        <ActivityIndicator color={V4.green} size="large" />
      </View>
    );
  }

  return (
    <View style={v4Styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          v4Styles.scrollContent,
          { paddingTop: Math.max(insets.top, 6) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={props.refreshing}
            onRefresh={props.onRefresh}
            tintColor={V4.green}
            colors={[V4.green]}
          />
        }
      >
        {/* Header — compact: avatar + greeting + credit */}
        <View style={styles.headerTop}>
          <PressCard onPress={props.onToggleMenu} style={styles.iconBtn}>
            <Image
              source={LANGUAGE_GLOBE_ICON}
              style={styles.languageIcon}
              resizeMode="contain"
            />
          </PressCard>
          <View style={styles.avatarOuter}>
            <View style={styles.avatarWrap}>
              {showAvatarPhoto ? (
                <Image
                  key={props.avatarUrl || "avatar"}
                  source={{ uri: props.avatarUrl! }}
                  style={styles.avatarImg}
                  resizeMode="cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{props.initials.slice(0, 1)}</Text>
                </View>
              )}
            </View>
            <View style={styles.onlineDot} />
          </View>
          <PressCard onPress={props.onNavigateInbox} style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={17} color={V4.textPrimary} />
            {props.activeOrdersCount > 0 ? <View style={styles.notifDot} /> : null}
          </PressCard>
        </View>

        <View style={styles.greetingRow}>
          <View style={styles.greetingCol}>
            <Text style={styles.greetingLine}>
              {props.greeting} {"👋"}
            </Text>
            <Text style={styles.nameLine} numberOfLines={1}>
              {props.firstName || "Client"}
            </Text>
            <PressCard onPress={props.onRefreshLocation} style={styles.locationRow}>
              <Ionicons name="location" size={13} color={V4.green} />
              <Text style={styles.locationText} numberOfLines={1}>
                {props.displayLocation ||
                  props.scopeLabel ||
                  props.ts("client.home.location.unknown", "Current location")}
              </Text>
              <Ionicons name="chevron-down" size={12} color={V4.textSoft} />
            </PressCard>
          </View>

          <View style={styles.areaMidSlot} pointerEvents="box-none">
            {props.areaLabel ? (
              <Pressable onPress={props.onRefreshLocation} hitSlop={8}>
                <Text style={styles.areaMidText} numberOfLines={1}>
                  {props.areaLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.creditCol}>
            <PressCard
              onPress={props.onNavigateWallet ?? props.onNavigateRewards}
              style={styles.creditCard}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.creditLabel}>
                  {props.ts("client.home.credit.title", "Crédit MMD")}
                </Text>
                <Text style={styles.creditValue}>{creditLabel}</Text>
                <Text style={styles.creditAvail}>
                  {props.ts("client.home.credit.available", "Available")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={V4.green} />
            </PressCard>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <PressCard onPress={openSearchHub} style={styles.searchBar}>
            <Ionicons name="search" size={16} color={V4.searchIcon} />
            <Text style={styles.searchPlaceholder} numberOfLines={1}>
              {props.ts(
                "client.home.search.placeholder",
                "Where do you want to go or what do you need?",
              )}
            </Text>
          </PressCard>
          <PressCard onPress={openSearchHub} style={styles.filterBtn}>
            <Ionicons name="options-outline" size={16} color={V4.textPrimary} />
          </PressCard>
        </View>

        {props.error ? (
          <Text style={styles.errorText}>
            {props.ts(props.error.key, props.error.fallback, props.error.params)}
          </Text>
        ) : null}

        {/* Services */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {props.ts("client.home.services.title", "Services")}
          </Text>
          <PressCard onPress={openSearchHub}>
            <Text style={styles.sectionLink}>
              {props.ts("client.home.viewAll", "View all")}
            </Text>
          </PressCard>
        </View>

        <View style={styles.servicesRow}>
          {services.map((svc) => (
            <PressCard
              key={svc.key}
              onPress={svc.enabled ? svc.onPress : undefined}
              disabled={!svc.enabled}
              style={styles.serviceCard}
            >
              <View style={[styles.serviceBadge, { backgroundColor: svc.badgeBg }]}>
                <Text style={[styles.serviceBadgeText, { color: svc.badgeFg }]}>{svc.badge}</Text>
              </View>
              <Image source={svc.art} style={styles.serviceArtImg} resizeMode="contain" />
              <Text
                style={styles.serviceTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {svc.title}
              </Text>
              <Text style={styles.serviceSub} numberOfLines={1}>
                {svc.enabled
                  ? svc.subtitle
                  : svc.key === "marketplace"
                    ? props.marketplaceSoonLabel
                    : props.comingSoonLabel}
              </Text>
              <View style={[styles.serviceCta, { backgroundColor: svc.accent }]}>
                <Ionicons name="arrow-forward" size={11} color="#FFFFFF" />
              </View>
            </PressCard>
          ))}
        </View>

        {/* Advertisements — real Supabase CMS only */}
        {props.advertisements.length > 0 ? (
          <View style={styles.adsBlock}>
            <FlatList
              data={props.advertisements}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={AD_CARD_W + AD_GAP}
              contentContainerStyle={{ gap: AD_GAP }}
              onScroll={onAdsScroll}
              scrollEventThrottle={16}
              nestedScrollEnabled
              renderItem={({ item }) => (
                <PressCard
                  style={styles.adCard}
                  onPress={() => props.onAdClick(item)}
                >
                  <Image
                    source={{ uri: item.image_url }}
                    style={styles.adImage}
                    resizeMode="cover"
                  />
                  <View style={styles.adScrim} />
                  <View style={styles.adContent}>
                    <Text style={styles.adTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text style={styles.adSub} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                    {item.button_text ? (
                      <View style={styles.adBtn}>
                        <Text style={styles.adBtnText}>{item.button_text}</Text>
                      </View>
                    ) : null}
                  </View>
                </PressCard>
              )}
            />
            <View style={styles.dotsRow}>
              {props.advertisements.map((ad, i) => (
                <View
                  key={ad.id}
                  style={[styles.dot, i === adIndex ? styles.dotActive : null]}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* MMD Rewards */}
        <PressCard onPress={props.onNavigateRewards} style={styles.rewardsCard}>
          <Text style={styles.rewardsEyebrow}>
            {props.ts("client.home.rewards.title", "MMD Rewards")}
          </Text>
          <View style={styles.rewardsBody}>
            <View style={styles.rewardsMedal}>
              <Ionicons name="medal" size={22} color="#B45309" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rewardsLevel}>
                {props.stats.level} {props.ts("client.home.rewards.member", "Member")}
              </Text>
              <View style={styles.rewardsProgressRow}>
                <Text style={styles.rewardsProgressText} numberOfLines={1}>
                  {progressLabel}
                </Text>
                <Ionicons name="information-circle-outline" size={14} color={V4.textSoft} />
              </View>
            </View>
            <View style={styles.tierBadge}>
              <Text style={styles.tierBadgeLetter}>
                {(props.stats.level || "B").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.rewardsFooter}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: props.progressBarWidth }]} />
            </View>
            <View style={styles.rewardsLinkRow}>
              <Text style={styles.sectionLink}>
                {props.ts("client.home.rewards.view", "View rewards")}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={V4.green} />
            </View>
          </View>
        </PressCard>

        {/* Recent activity */}
        <View style={[styles.sectionHeader, { marginTop: 12 }]}>
          <Text style={styles.sectionTitle}>
            {props.ts("client.home.activity.title", "Recent activity")}
          </Text>
          <PressCard onPress={props.onNavigateOrders}>
            <Text style={styles.sectionLink}>
              {props.ts("client.home.viewAll", "View all")}
            </Text>
          </PressCard>
        </View>

        {props.recentActivityUnavailable ? (
          <Text style={styles.mutedNote}>
            {props.ts(
              "client.home.activity.unavailable",
              "Recent activity is temporarily unavailable.",
            )}
          </Text>
        ) : props.items.length === 0 ? (
          <Text style={styles.mutedNote}>
            {props.ts("client.home.activity.empty", "No recent trips yet.")}
          </Text>
        ) : (
          props.items.slice(0, 5).map((item) => {
            const meta = serviceMeta(item.kind);
            const label = props.statusLabel(item);
            return (
              <PressCard
                key={`${item.kind}-${item.id}`}
                onPress={() => props.onOpenOrder(item)}
                style={styles.activityRow}
              >
                <View style={[styles.activityBadge, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.activityBadgeText, { color: meta.color }]}>
                    {meta.badge}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.activityTitle} numberOfLines={1}>
                    {props.recentTitle(item)}
                  </Text>
                  <Text style={styles.activityMeta} numberOfLines={1}>
                    {props.formatCompactDateTime(item.created_at)}
                  </Text>
                </View>
                <View style={styles.activityRight}>
                  <Text style={styles.activityPrice}>
                    {props.formatCurrency(item.total)}
                  </Text>
                  <Text style={[styles.activityStatus, { color: statusTone(label) }]} numberOfLines={1}>
                    {label.replace(/^[^\w]+/, "").trim() || label}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={V4.textSoft} />
              </PressCard>
            );
          })
        )}
      </ScrollView>

      {/* Bottom nav */}
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <PressCard onPress={() => {}} style={styles.tabItem}>
          <Ionicons name="home" size={22} color={V4.green} />
          <Text style={[styles.tabLabel, styles.tabLabelActive]}>
            {props.ts("client.home.tabs.home", "Home")}
          </Text>
        </PressCard>
        <PressCard onPress={props.onNavigateOrders} style={styles.tabItem}>
          <Ionicons name="receipt-outline" size={22} color={V4.textSoft} />
          <Text style={styles.tabLabel}>{props.ts("client.home.tabs.orders", "Orders")}</Text>
        </PressCard>

        <View style={styles.aiSlot}>
          <Animated.View style={{ transform: [{ scale: aiScale }] }}>
            <PressCard onPress={props.onNavigateAi} style={styles.aiBtn}>
              <Ionicons name="sparkles" size={22} color="#FFFFFF" />
              <Text style={styles.aiLabel}>
                {props.ts("client.home.tabs.ai", "Ask MMD AI")}
              </Text>
            </PressCard>
          </Animated.View>
        </View>

        <PressCard onPress={props.onNavigateInbox} style={styles.tabItem}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={V4.textSoft} />
          <Text style={styles.tabLabel}>{props.ts("client.home.tabs.inbox", "Inbox")}</Text>
        </PressCard>
        <PressCard onPress={props.onNavigateProfile} style={styles.tabItem}>
          <Ionicons name="person-outline" size={22} color={V4.textSoft} />
          <Text style={styles.tabLabel}>{props.ts("client.home.tabs.account", "Account")}</Text>
        </PressCard>
      </View>

      <ClientHomeLanguageSheet
        visible={props.menuOpen}
        currentLang={props.currentLang}
        onClose={props.onCloseMenu}
        onSelect={props.onChangeLang}
        ts={props.ts}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: V4.border,
    backgroundColor: V4.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  languageIcon: {
    width: 18,
    height: 18,
  },
  avatarOuter: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  avatarImg: { width: 63, height: 63, borderRadius: 31.5 },
  avatarFallback: {
    width: 63,
    height: 63,
    borderRadius: 31.5,
    backgroundColor: V4.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: V4.greenDark, fontSize: 24, fontWeight: "800" },
  onlineDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: V4.green,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  notifDot: {
    position: "absolute",
    top: 6,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: V4.danger,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  greetingCol: { flex: 1, minWidth: 0, paddingRight: 4 },
  greetingLine: { color: V4.textSecondary, fontSize: 12, fontWeight: "500", lineHeight: 15 },
  nameLine: { color: V4.textPrimary, fontSize: 20, fontWeight: "800", marginTop: 0, lineHeight: 24 },
  areaMidSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  areaMidText: {
    maxWidth: "100%",
    color: V4.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    fontStyle: "italic",
    textAlign: "center",
  },
  creditCol: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
    paddingLeft: 4,
  },
  creditCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 9,
    paddingVertical: 7,
    minWidth: 100,
    maxWidth: "100%",
    ...V4_SHADOW_SOFT,
  },
  creditLabel: { color: V4.textSecondary, fontSize: 9.5, fontWeight: "600" },
  creditValue: { color: V4.green, fontSize: 15, fontWeight: "800", marginTop: 0 },
  creditAvail: { color: V4.green, fontSize: 9.5, fontWeight: "600", marginTop: 0 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    marginTop: 1,
    maxWidth: "100%",
  },
  locationText: { color: V4.textPrimary, fontSize: 11.5, fontWeight: "600", flexShrink: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5, marginTop: 0 },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 11,
    minHeight: 40,
    ...V4_SHADOW_SOFT,
  },
  searchPlaceholder: { flex: 1, color: V4.textSoft, fontSize: 11.5, fontWeight: "500" },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V4.border,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...V4_SHADOW_SOFT,
  },
  errorText: { color: V4.danger, fontSize: 12, marginBottom: 6 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  sectionTitle: { color: V4.textPrimary, fontSize: 15, fontWeight: "800" },
  sectionLink: { color: V4.green, fontSize: 12, fontWeight: "700" },
  servicesRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 5,
    marginBottom: 6,
  },
  serviceCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V4.border,
    paddingTop: 5,
    paddingHorizontal: 4,
    paddingBottom: 22,
    ...V4_SHADOW,
  },
  serviceBadge: {
    alignSelf: "flex-start",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  serviceBadgeText: { fontSize: 7.5, fontWeight: "800" },
  serviceArtImg: {
    width: "100%",
    height: 50,
    alignSelf: "center",
    marginTop: 1,
    marginBottom: 1,
  },
  serviceTitle: { color: V4.textPrimary, fontSize: 10.5, fontWeight: "800" },
  serviceSub: { color: V4.textSecondary, fontSize: 8.5, fontWeight: "500", marginTop: 0 },
  serviceCta: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  adsBlock: { marginTop: 0, marginBottom: 2 },
  adCard: {
    width: AD_CARD_W,
    height: AD_CARD_H,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    ...V4_SHADOW,
  },
  adImage: { ...StyleSheet.absoluteFillObject },
  adScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.4)",
  },
  adContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 10,
  },
  adTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", lineHeight: 16 },
  adSub: { color: "rgba(255,255,255,0.9)", fontSize: 10, fontWeight: "500", marginTop: 2 },
  adBtn: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  adBtnText: { color: V4.textPrimary, fontSize: 11, fontWeight: "700" },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    marginTop: 6,
    marginBottom: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#E2E8F0" },
  dotActive: { backgroundColor: V4.green, width: 7, height: 7, borderRadius: 3.5 },
  rewardsCard: {
    marginTop: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 12,
    ...V4_SHADOW_SOFT,
  },
  rewardsEyebrow: { color: V4.green, fontSize: 11, fontWeight: "700", marginBottom: 8 },
  rewardsBody: { flexDirection: "row", alignItems: "center", gap: 8 },
  rewardsMedal: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardsLevel: { color: V4.textPrimary, fontSize: 14, fontWeight: "800" },
  rewardsProgressRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  rewardsProgressText: { color: V4.textSecondary, fontSize: 11, fontWeight: "500", flexShrink: 1 },
  tierBadge: {
    width: 40,
    height: 46,
    borderRadius: 9,
    backgroundColor: "#B45309",
    alignItems: "center",
    justifyContent: "center",
  },
  tierBadgeLetter: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  rewardsFooter: { marginTop: 10, gap: 6 },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: V4.green, borderRadius: 999 },
  rewardsLinkRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 10,
    marginBottom: 6,
    ...V4_SHADOW_SOFT,
  },
  activityBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  activityBadgeText: { fontSize: 11, fontWeight: "800" },
  activityTitle: { color: V4.textPrimary, fontSize: 13, fontWeight: "800" },
  activityMeta: { color: V4.textSecondary, fontSize: 11, marginTop: 1 },
  activityRight: { alignItems: "flex-end", marginRight: 2 },
  activityPrice: { color: V4.textPrimary, fontSize: 13, fontWeight: "800" },
  activityStatus: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  mutedNote: { color: V4.textSecondary, fontSize: 12, marginBottom: 6 },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: V4.border,
    paddingHorizontal: 10,
    paddingTop: 8,
    ...V4_SHADOW,
  },
  tabItem: { flex: 1, alignItems: "center", gap: 2, paddingBottom: 2 },
  tabLabel: { color: V4.textSoft, fontSize: 10, fontWeight: "600" },
  tabLabelActive: { color: V4.green, fontWeight: "700" },
  aiSlot: {
    width: 86,
    alignItems: "center",
    marginTop: -28,
  },
  aiBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    shadowColor: V4.green,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  aiLabel: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 4,
  },
});

/** Resolve ad CTA without inventing destinations — maps known tokens to existing navigators. */
export function resolveClientAdAction(
  action: string | null | undefined,
  handlers: {
    taxi: () => void;
    food: () => void;
    delivery: () => void;
    marketplace: () => void;
    rewards: () => void;
    mmdPlus: () => void;
  },
): void {
  const raw = String(action ?? "").trim();
  if (!raw) return;
  const lower = raw.toLowerCase();
  if (lower === "taxi" || lower.includes("taxi")) return handlers.taxi();
  if (lower === "food" || lower.includes("restaurant") || lower.includes("food")) {
    return handlers.food();
  }
  if (lower === "delivery" || lower.includes("delivery")) return handlers.delivery();
  if (lower === "marketplace" || lower.includes("market")) return handlers.marketplace();
  if (lower === "rewards" || lower.includes("loyalty") || lower.includes("reward")) {
    return handlers.rewards();
  }
  if (lower.includes("mmd+") || lower.includes("mmdplus") || lower.includes("plus")) {
    return handlers.mmdPlus();
  }
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    void Linking.openURL(raw);
  }
}
