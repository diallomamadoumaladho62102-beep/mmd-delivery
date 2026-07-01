import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppLanguageCode } from "../../../i18n/languageOptions";
import type { PlatformFeaturesResponse } from "../../../lib/platformFeaturesApi";
import { ClientHomeLanguageSheet } from "./ClientHomeLanguageSheet";
import { V4, V4_RADIUS, V4_SHADOW, v4Styles } from "./clientHomeTheme";

export type ClientHomeItem = {
  id: string;
  kind: "restaurant_order" | "delivery_request";
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
  stats: {
    points: number;
    level: string;
    nextLevelTarget: number;
    inProgress: number;
    delivered: number;
  };
  progressBarWidth: `${number}%`;
  menuOpen: boolean;
  currentLang: string;
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
  onNavigateAi: () => void;
  onOpenOrder: (item: ClientHomeItem) => void;
  onOpenChat: (orderId: string) => void;
  formatCurrency: (amount: number | null | undefined) => string;
  formatCompactDateTime: (iso: string | null) => string;
  recentTitle: (item: ClientHomeItem) => string;
  statusLabel: (item: ClientHomeItem) => string;
};

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
        pressed && !disabled ? { opacity: 0.88, transform: [{ scale: 0.985 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

function ServiceGlyph({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.serviceGlyph, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
      <Text style={[styles.serviceGlyphText, { color }]}>{label}</Text>
    </View>
  );
}

function MapHeroFallback() {
  return (
    <View style={styles.mapScene} pointerEvents="none">
      <View style={styles.mapZoneA} />
      <View style={styles.mapZoneB} />
      <View style={styles.mapZoneC} />
      <View style={[styles.mapRoad, styles.mapRoadH1]} />
      <View style={[styles.mapRoad, styles.mapRoadH2]} />
      <View style={[styles.mapRoad, styles.mapRoadV1]} />
      <View style={[styles.mapRoad, styles.mapRoadV2]} />
      <View style={[styles.mapRoadGlow, styles.mapRoadGlowH1]} />
      <View style={[styles.mapRoadGlow, styles.mapRoadGlowV1]} />
      <View style={styles.mapIntersection} />
      <View style={[styles.mapMarker, styles.mapMarkerFood]}>
        <Text style={[styles.mapMarkerGlyph, { color: V4.green }]}>FD</Text>
      </View>
      <View style={[styles.mapMarker, styles.mapMarkerTaxi]}>
        <Text style={[styles.mapMarkerGlyph, { color: "#FACC15" }]}>TX</Text>
      </View>
      <View style={[styles.mapMarker, styles.mapMarkerDelivery]}>
        <Text style={[styles.mapMarkerGlyph, { color: V4.purple }]}>DL</Text>
      </View>
      <View style={styles.mapUserPulseOuter} />
      <View style={styles.mapUserPulseInner} />
      <View style={styles.mapGlowDriverA} />
      <View style={styles.mapGlowDriverB} />
    </View>
  );
}

function formatScopeLocation(scopeLabel: string | null): string {
  if (!scopeLabel) return "Your area";
  if (scopeLabel.startsWith("US / ")) {
    const state = scopeLabel.replace("US / ", "").trim();
    const names: Record<string, string> = {
      NY: "New York, NY",
      NJ: "New Jersey, NJ",
      CA: "California, CA",
      TX: "Texas, TX",
      FL: "Florida, FL",
      PA: "Pennsylvania, PA",
    };
    return names[state] ?? `${state}, US`;
  }
  if (scopeLabel.startsWith("GN / ")) {
    return `${scopeLabel.replace("GN / ", "").trim()}, Guinea`;
  }
  return scopeLabel;
}

export function ClientHomeV4View(props: ClientHomeV4ViewProps) {
  const {
    ts,
    loading,
    refreshing,
    items,
    error,
    recentActivityUnavailable,
    avatarUrl,
    initials,
    firstName,
    greeting,
    displayLocation,
    spendingAmount,
    activeOrdersCount,
    platformFeatures,
    comingSoonLabel,
    marketplaceSoonLabel,
    scopeLabel,
    showUseCurrentLocation,
    stats,
    progressBarWidth,
    menuOpen,
    currentLang,
    onRefresh,
    onRefreshLocation,
    onChangeLang,
    onCloseMenu,
    onToggleMenu,
    onSignOut,
    onSwitchRole,
    onNavigateTaxi,
    onNavigateFood,
    onNavigateDelivery,
    onNavigateMarketplace,
    onNavigateInbox,
    onNavigateProfile,
    onNavigateOrders,
    onNavigateRewards,
    onNavigateAi,
    onOpenOrder,
    onOpenChat,
    formatCurrency,
    formatCompactDateTime,
    recentTitle,
    statusLabel,
  } = props;

  const [searchFocused, setSearchFocused] = useState(false);
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const scrollBottomPadding = 132 + Math.max(insets.bottom, Platform.OS === "android" ? 16 : 10);
  const bottomNavOffset = Math.max(insets.bottom, Platform.OS === "android" ? 14 : 10);
  const headerTopPadding = Math.max(insets.top, Platform.OS === "android" ? 10 : 6) + 10;

  const liveIntel = useMemo(() => {
    const driversEstimate = stats.inProgress > 0 ? Math.max(6, stats.inProgress * 3 + 9) : null;
    const restaurantsEstimate = platformFeatures.restaurant_available ? 48 : 12;

    return {
      drivers: driversEstimate != null ? `~${driversEstimate}` : "—",
      restaurants: platformFeatures.restaurant_available ? `~${restaurantsEstimate}` : "—",
      avgDelivery: platformFeatures.restaurant_available || platformFeatures.delivery_available ? "~18m" : "—",
      traffic:
        platformFeatures.taxi_available || platformFeatures.delivery_available
          ? ts("client.home.v4.traffic.good", "Good")
          : "—",
    };
  }, [platformFeatures.delivery_available, platformFeatures.restaurant_available, platformFeatures.taxi_available, stats.inProgress, ts]);

  const openSearchHub = useCallback(() => {
    Alert.alert(
      ts("client.home.v4.search.title", "What do you need?"),
      ts("client.home.v4.search.subtitle", "Choose a service to continue"),
      [
        { text: ts("client.home.banner.taxi.title", "Taxi"), onPress: onNavigateTaxi },
        { text: ts("client.home.banner.restaurant.title", "Food"), onPress: onNavigateFood },
        { text: ts("client.home.banner.delivery.title", "Delivery"), onPress: onNavigateDelivery },
        {
          text: ts("client.home.banner.marketplace.title", "Marketplace"),
          onPress: onNavigateMarketplace,
        },
        { text: ts("common.cancel", "Cancel"), style: "cancel" },
      ]
    );
  }, [onNavigateDelivery, onNavigateFood, onNavigateMarketplace, onNavigateTaxi, ts]);

  const openMoreServices = useCallback(() => {
    Alert.alert(
      ts("client.home.v4.more.title", "All services"),
      undefined,
      [
        { text: "Taxi", onPress: onNavigateTaxi },
        { text: "Food", onPress: onNavigateFood },
        { text: "Delivery", onPress: onNavigateDelivery },
        { text: "Marketplace", onPress: onNavigateMarketplace },
        { text: ts("client.home.v4.inbox", "Inbox"), onPress: onNavigateInbox },
        { text: ts("common.cancel", "Cancel"), style: "cancel" },
      ]
    );
  }, [onNavigateDelivery, onNavigateFood, onNavigateInbox, onNavigateMarketplace, onNavigateTaxi, ts]);

  const openAiAssistant = useCallback(() => {
    onNavigateAi();
  }, [onNavigateAi]);

  const recentItems = items.slice(0, 4);
  const locationLine = displayLocation || formatScopeLocation(scopeLabel) || ts("client.home.v4.yourArea", "Your area");
  const areaCardLine = formatScopeLocation(scopeLabel) || locationLine;
  const showRecentUnavailable = recentActivityUnavailable && !loading && recentItems.length === 0;
  const showRecentEmpty = !showRecentUnavailable && !loading && recentItems.length === 0;

  const activeOrdersBadgeLabel =
    activeOrdersCount > 0
      ? ts("client.home.v4.inbox.activeOrdersBadge", "{{count}} active orders", {
          count: activeOrdersCount,
        })
      : ts("client.home.v4.inbox.open", "Open inbox");

  return (
    <Pressable style={v4Styles.root} onPress={onCloseMenu} testID="client-home-v4">
      <ScrollView
        testID="client-home-v4-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          v4Styles.scrollContent,
          { paddingTop: headerTopPadding, paddingBottom: scrollBottomPadding },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={V4.green} />
        }
      >
        <View style={styles.headerRow} testID="client-home-v4-header">
          <View style={styles.headerLeft}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              <View style={styles.onlineDot} />
            </View>

            <View style={styles.headerTextWrap}>
              <Text style={styles.greetingLine} numberOfLines={1}>
                {greeting}
              </Text>
              <Text style={styles.greetingName} numberOfLines={1}>
                {firstName}
              </Text>
              <Pressable
                onPress={showUseCurrentLocation ? onRefreshLocation : undefined}
                style={styles.locationRow}
              >
                <Text style={styles.locationPin}>⌖</Text>
                <Text style={styles.locationText} numberOfLines={1}>
                  {locationLine}
                </Text>
                {showUseCurrentLocation ? <Text style={styles.locationRefresh}>↻</Text> : null}
              </Pressable>
            </View>
          </View>

          <View style={styles.headerActions}>
            <View style={styles.headerIconRow}>
              <Pressable
                style={styles.iconButton}
                onPress={() => setLanguageSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={ts("language.pickerTitle", "Language")}
                testID="client-home-language-button"
                hitSlop={8}
              >
                <Text style={styles.languageButtonGlyph}>🌐</Text>
              </Pressable>
              <Pressable
                style={styles.iconButton}
                onPress={onNavigateInbox}
              accessibilityRole="button"
              accessibilityLabel={activeOrdersBadgeLabel}
              testID="client-home-inbox-button"
              hitSlop={8}
            >
              <Text style={styles.iconButtonGlyph}>◔</Text>
              {activeOrdersCount > 0 ? (
                <View style={styles.activeOrdersBadge}>
                  <Text style={styles.activeOrdersBadgeText}>{Math.min(99, activeOrdersCount)}</Text>
                </View>
              ) : null}
              </Pressable>
            </View>
            <Pressable
              style={styles.spendingButton}
              onPress={onNavigateProfile}
              accessibilityRole="button"
              accessibilityLabel={
                spendingAmount
                  ? ts("client.home.v4.activity.a11y", "Total spent {{amount}}, opens profile", {
                      amount: spendingAmount,
                    })
                  : ts("client.home.v4.activity.openProfile", "Open activity profile")
              }
              testID="client-home-spending-button"
              hitSlop={8}
            >
              <Text style={styles.spendingEyebrow}>{ts("client.home.v4.activity.label", "Activity")}</Text>
              {spendingAmount ? (
                <Text style={styles.spendingAmount} numberOfLines={1}>
                  {spendingAmount}
                </Text>
              ) : (
                <Text style={styles.spendingPlaceholder} numberOfLines={1}>
                  {ts("client.home.v4.activity.empty", "View activity")}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {menuOpen ? (
          <View style={styles.accountMenu}>
            <Pressable style={styles.menuItem} onPress={onSwitchRole}>
              <Text style={styles.menuItemText}>{ts("client.home.menu.switchRole", "Switch role")}</Text>
            </Pressable>
            <Pressable style={[styles.menuItem, styles.menuItemDanger]} onPress={onSignOut}>
              <Text style={styles.menuItemDangerText}>{ts("client.home.menu.signOut", "Sign out")}</Text>
            </Pressable>
          </View>
        ) : null}

        {error?.key === "client.home.errors.must_login" ? (
          <View style={styles.softNoticeCard}>
            <Text style={styles.softNoticeTitle}>
              {ts(error.key, error.fallback, error.params)}
            </Text>
          </View>
        ) : null}

        {platformFeatures.maintenance_mode ? (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              {platformFeatures.message ??
                ts(
                  "client.home.maintenanceBanner",
                  "MMD is under maintenance in your area. New orders are temporarily disabled."
                )}
            </Text>
          </View>
        ) : null}

        {scopeLabel ? (
          <View style={styles.areaCard} testID="client-home-area-card">
            <Text style={styles.areaCardTitle}>📍 {areaCardLine}</Text>
            <Text style={styles.areaCardSub}>
              {ts("client.home.v4.area.servicesAvailable", "Services available in your area")}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.searchBar, searchFocused && styles.searchBarFocused]}
          onPress={openSearchHub}
          accessibilityRole="button"
          accessibilityLabel={ts(
            "client.home.v4.search.placeholder",
            "Where do you want to go or what do you need?"
          )}
          testID="client-home-search"
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            editable={false}
            pointerEvents="none"
            placeholder={ts(
              "client.home.v4.search.placeholder",
              "Where do you want to go or what do you need?"
            )}
            placeholderTextColor={V4.textSecondary}
            style={styles.searchInput}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <Pressable
            style={styles.filterButton}
            onPress={() => {
              Alert.alert(
                ts("client.home.v4.preferences", "Preferences"),
                undefined,
                [
                  {
                    text: ts("client.home.scope.useCurrentLocation", "Use my current location"),
                    onPress: onRefreshLocation,
                  },
                  { text: ts("common.cancel", "Cancel"), style: "cancel" },
                ]
              );
            }}
          >
            <Text style={styles.filterButtonText}>☰</Text>
          </Pressable>
        </Pressable>

        <View style={styles.intelBar} testID="client-home-live-intel">
          <IntelPill
            value={liveIntel.drivers}
            label={ts("client.home.v4.intel.drivers", "Nearby drivers")}
          />
          <IntelPill
            value={liveIntel.restaurants}
            label={ts("client.home.v4.intel.restaurants", "Open restaurants")}
          />
          <IntelPill
            value={liveIntel.avgDelivery}
            label={ts("client.home.v4.intel.avgDelivery", "Avg delivery")}
          />
          <IntelPill
            value={liveIntel.traffic}
            label={ts("client.home.v4.intel.traffic", "Traffic")}
            accent
          />
        </View>
        <Text style={styles.intelDisclaimer}>
          {ts(
            "client.home.v4.intel.disclaimer",
            "Area estimates — not live guarantees"
          )}
        </Text>

        {/* Fallback hero map — live Mapbox feed ships in a future client home release. */}
        <View style={styles.mapHero} testID="client-home-map-hero">
          <MapHeroFallback />
          <View style={styles.mapOverlayTop}>
            <View style={styles.mapBadge}>
              <View style={styles.mapBadgeDot} />
              <Text style={styles.mapBadgeText} numberOfLines={1}>
                {liveIntel.drivers === "—"
                  ? ts("client.home.v4.map.noData", "Map preview")
                  : `${liveIntel.drivers} ${ts("client.home.v4.map.driversNear", "nearby drivers (est.)")}`}
              </Text>
            </View>
            <Pressable style={styles.mapViewButton}>
              <Text style={styles.mapViewButtonText}>{ts("client.home.v4.map.view", "Map view")}</Text>
            </Pressable>
          </View>
          <View style={styles.mapOverlayBottom}>
            <Text style={styles.mapEta}>
              {liveIntel.avgDelivery === "—"
                ? ts("client.home.v4.map.preview", "Stylized map preview")
                : ts("client.home.v4.map.eta", "~{{minutes}} min avg in your area", {
                    minutes: "18",
                  })}
            </Text>
          </View>
        </View>

        <PressCard style={styles.heroCard} onPress={onNavigateDelivery}>
          <View style={styles.heroCardContent}>
            <View style={styles.heroCardCopy}>
              <Text style={styles.heroEyebrow}>MMD Delivery</Text>
              <Text style={styles.heroTitle}>
                {ts("client.home.v4.hero.title", "All MMD services in one place.")}
              </Text>
              <Text style={styles.heroSubtitle}>
                {ts(
                  "client.home.v4.hero.subtitle",
                  "Food, taxi, delivery and marketplace — ready in your area."
                )}
              </Text>
              <View style={styles.heroCta}>
                <Text style={styles.heroCtaText}>{ts("client.home.v4.hero.cta", "Order now →")}</Text>
              </View>
            </View>
            <View style={styles.heroArt}>
              <Text style={styles.heroArtGlyph}>MMD</Text>
            </View>
          </View>
        </PressCard>

        <Text style={styles.sectionTitle}>{ts("client.home.v4.services", "Services")}</Text>
        <View style={styles.servicesGrid} testID="client-home-services-grid">
          <ServiceCard
            title={ts("client.home.banner.taxi.title", "Taxi")}
            subtitle={ts("client.home.v4.service.taxi", "Ride anywhere")}
            glyph="TX"
            color="#FACC15"
            disabled={!platformFeatures.taxi_available}
            comingSoon={comingSoonLabel}
            onPress={onNavigateTaxi}
          />
          <ServiceCard
            title={ts("client.home.banner.restaurant.title", "Food")}
            subtitle={ts("client.home.v4.service.food", "Order now")}
            glyph="FD"
            color={V4.green}
            disabled={!platformFeatures.restaurant_available}
            comingSoon={comingSoonLabel}
            onPress={onNavigateFood}
          />
          <ServiceCard
            title={ts("client.home.banner.delivery.title", "Delivery")}
            subtitle={ts("client.home.v4.service.delivery", "Send anything")}
            glyph="DL"
            color={V4.purple}
            disabled={!platformFeatures.delivery_available}
            comingSoon={comingSoonLabel}
            onPress={onNavigateDelivery}
          />
          <ServiceCard
            title={ts("client.home.banner.marketplace.title", "Marketplace")}
            subtitle={ts("client.home.v4.service.marketplace", "Shop & save")}
            glyph="MK"
            color="#38BDF8"
            disabled={!platformFeatures.marketplace_available}
            comingSoon={marketplaceSoonLabel}
            onPress={onNavigateMarketplace}
          />
        </View>

        <PressCard style={styles.moreCard} onPress={openMoreServices}>
          <Text style={styles.moreCardTitle}>{ts("client.home.v4.more.title", "More services")}</Text>
          <Text style={styles.moreCardSub}>{ts("client.home.v4.more.sub", "Explore all MMD modules")}</Text>
        </PressCard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
          <QuickPill label={ts("client.home.v4.quick.home", "Home")} active />
          <QuickPill label={ts("client.home.v4.quick.work", "Work")} />
          <QuickPill label={ts("client.home.v4.quick.favorites", "Favorites")} />
          <QuickPill label={ts("client.home.v4.quick.promo", "Promo")} onPress={onNavigateFood} />
        </ScrollView>

        <PressCard
          style={styles.rewardsCard}
          onPress={onNavigateRewards}
          testID="client-home-rewards-card"
        >
          <View style={styles.rewardsLeft}>
            <Text style={styles.rewardsEyebrow}>{ts("client.home.rewards.title", "MMD Rewards")}</Text>
            <Text style={styles.rewardsLevel}>
              {stats.level} {ts("client.home.v4.rewards.member", "Member")}
            </Text>
            <Text style={styles.rewardsProgress}>
              {stats.points} / {stats.nextLevelTarget}{" "}
              {ts("client.home.v4.rewards.untilNext", "pts until next tier")}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressBarWidth }]} />
            </View>
            <Text style={styles.rewardsLink}>{ts("client.home.v4.rewards.view", "View rewards →")}</Text>
          </View>
          <View style={styles.rewardsBadge}>
            <Text style={styles.rewardsBadgeText}>{stats.level.slice(0, 1)}</Text>
          </View>
        </PressCard>

        <PressCard style={styles.promoCard} onPress={onNavigateFood} testID="client-home-promo-card">
          <View style={styles.promoCopy}>
            <Text style={styles.promoEyebrow}>{ts("client.home.v4.promo.limited", "Limited time")}</Text>
            <Text style={styles.promoTitle}>20% OFF</Text>
            <Text style={styles.promoSub}>
              {ts("client.home.v4.promo.food", "On your next food order")}
            </Text>
            <View style={styles.promoCta}>
              <Text style={styles.promoCtaText}>{ts("client.home.v4.promo.cta", "Order now")}</Text>
            </View>
          </View>
          <View style={styles.promoArt}>
            <Text style={styles.promoArtGlyph}>FOOD</Text>
          </View>
        </PressCard>

        <View style={styles.recentHeader} testID="client-home-recent-activity">
          <Text style={styles.sectionTitle}>{ts("client.home.section.recent", "Recent Activity")}</Text>
          {loading ? (
            <ActivityIndicator color={V4.green} size="small" />
          ) : (
            <Pressable onPress={onNavigateOrders}>
              <Text style={styles.viewAll}>{ts("client.home.v4.viewAll", "See all ›")}</Text>
            </Pressable>
          )}
        </View>

        {showRecentUnavailable ? (
          <View style={styles.unavailableCard}>
            <Text style={styles.unavailableTitle}>
              {ts(
                "client.home.v4.recent.unavailableTitle",
                "Recent activity temporarily unavailable"
              )}
            </Text>
            <Text style={styles.unavailableSub}>
              {ts("client.home.v4.recent.pullToRefresh", "Pull to refresh")}
            </Text>
          </View>
        ) : showRecentEmpty ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {ts("client.home.v4.recent.emptyTitle", "No recent activity yet")}
            </Text>
            <Text style={styles.emptySub}>
              {ts(
                "client.home.v4.recent.emptySub",
                "Your orders and deliveries will appear here."
              )}
            </Text>
          </View>
        ) : (
          recentItems.map((item) => (
            <RecentRow
              key={`${item.kind}-${item.id}`}
              item={item}
              title={recentTitle(item)}
              status={statusLabel(item)}
              date={formatCompactDateTime(item.created_at)}
              amount={formatCurrency(item.total ?? item.delivery_fee)}
              onPress={() => onOpenOrder(item)}
              onChat={
                item.kind === "restaurant_order"
                  ? () => onOpenChat(item.id)
                  : undefined
              }
            />
          ))
        )}

      </ScrollView>

      <View
        style={[
          styles.bottomNav,
          { bottom: bottomNavOffset, paddingBottom: Math.max(insets.bottom * 0.35, 8) + 8 },
        ]}
        testID="client-home-bottom-nav"
      >
        <BottomTab
          label={ts("client.home.v4.tab.home", "Home")}
          active
          glyph="⌂"
          onPress={() => {}}
          testID="client-home-tab-home"
        />
        <BottomTab
          label={ts("client.home.v4.tab.orders", "Orders")}
          glyph="▢"
          onPress={onNavigateOrders}
          testID="client-home-tab-orders"
        />
        <Pressable
          style={styles.aiButton}
          onPress={openAiAssistant}
          accessibilityRole="button"
          accessibilityLabel={ts("client.home.v4.tab.ai", "Ask MMD AI")}
          testID="client-home-tab-ai"
          hitSlop={6}
        >
          <Text style={styles.aiButtonGlyph}>◆</Text>
          <Text style={styles.aiButtonLabel} numberOfLines={1}>
            {ts("client.home.v4.tab.ai", "Ask MMD AI")}
          </Text>
        </Pressable>
        <BottomTab
          label={ts("client.home.v4.tab.inbox", "Inbox")}
          glyph="✉"
          onPress={onNavigateInbox}
          testID="client-home-tab-inbox"
        />
        <BottomTab
          label={ts("client.home.v4.tab.account", "Account")}
          glyph="◎"
          onPress={onToggleMenu}
          testID="client-home-tab-account"
        />
      </View>

      <ClientHomeLanguageSheet
        visible={languageSheetVisible}
        ts={ts}
        currentLang={currentLang}
        onClose={() => setLanguageSheetVisible(false)}
        onSelect={onChangeLang}
      />
    </Pressable>
  );
}

function IntelPill({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <View style={[styles.intelPill, accent && styles.intelPillAccent]}>
      <Text style={[styles.intelValue, accent && styles.intelValueAccent]}>{value}</Text>
      <Text style={styles.intelLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function ServiceCard({
  title,
  subtitle,
  glyph,
  color,
  disabled,
  comingSoon,
  onPress,
}: {
  title: string;
  subtitle: string;
  glyph: string;
  color: string;
  disabled?: boolean;
  comingSoon?: string;
  onPress: () => void;
}) {
  return (
    <PressCard
      style={[styles.serviceCard, disabled && styles.serviceCardDisabled]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
    >
      <ServiceGlyph label={glyph} color={color} />
      <Text style={styles.serviceTitle}>{title}</Text>
      <Text style={styles.serviceSub} numberOfLines={2}>
        {disabled ? comingSoon ?? subtitle : subtitle}
      </Text>
    </PressCard>
  );
}

function QuickPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.quickPill, active && styles.quickPillActive]}
    >
      <Text style={[styles.quickPillText, active && styles.quickPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RecentRow({
  item,
  title,
  status,
  date,
  amount,
  onPress,
  onChat,
}: {
  item: ClientHomeItem;
  title: string;
  status: string;
  date: string;
  amount: string;
  onPress: () => void;
  onChat?: () => void;
}) {
  const delivered = item.status === "delivered";
  return (
    <PressCard style={styles.recentRow} onPress={onPress}>
      <View style={styles.recentIcon}>
        <Text style={styles.recentIconText}>{item.kind === "restaurant_order" ? "FD" : "DL"}</Text>
      </View>
      <View style={styles.recentBody}>
        <Text style={styles.recentTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.recentMeta} numberOfLines={1}>
          {date}
        </Text>
        <View style={[styles.statusPill, delivered && styles.statusPillDone]}>
          <Text style={[styles.statusPillText, delivered && styles.statusPillTextDone]}>{status}</Text>
        </View>
      </View>
      <View style={styles.recentRight}>
        <Text style={styles.recentAmount}>{amount}</Text>
        {onChat ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onChat();
            }}
            style={styles.chatButton}
          >
            <Text style={styles.chatButtonText}>Msg</Text>
          </Pressable>
        ) : null}
      </View>
    </PressCard>
  );
}

function BottomTab({
  label,
  glyph,
  active,
  onPress,
  testID,
}: {
  label: string;
  glyph: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.bottomTab}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
    >
      <Text style={[styles.bottomTabGlyph, active && styles.bottomTabGlyphActive]}>{glyph}</Text>
      <Text style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    minWidth: 0,
    paddingRight: 8,
  },
  avatarWrap: { position: "relative", marginTop: 4 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: V4.green,
  },
  avatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: V4.green,
    backgroundColor: V4.cardSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: V4.textPrimary, fontWeight: "900", fontSize: 18 },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: V4.green,
    borderWidth: 2,
    borderColor: V4.bg,
  },
  headerTextWrap: { flex: 1, marginLeft: 14, minWidth: 0, paddingTop: 2 },
  greetingLine: {
    color: V4.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  greetingName: {
    color: V4.textPrimary,
    fontWeight: "900",
    fontSize: 22,
    lineHeight: 28,
    marginTop: 2,
  },
  locationRow: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 4 },
  locationPin: { color: V4.green, fontSize: 12, fontWeight: "900" },
  locationText: { color: V4.textSecondary, fontSize: 14, fontWeight: "700", flex: 1 },
  locationRefresh: { color: V4.green, fontSize: 14, fontWeight: "900" },
  headerActions: { alignItems: "flex-end", gap: 8, maxWidth: 132 },
  headerIconRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  languageButtonGlyph: { fontSize: 18 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonGlyph: { color: V4.textPrimary, fontSize: 18, fontWeight: "700" },
  activeOrdersBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: V4.bg,
  },
  activeOrdersBadgeText: { color: V4.bg, fontSize: 10, fontWeight: "900" },
  spendingButton: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,217,95,0.12)",
    borderWidth: 1,
    borderColor: V4.borderGreen,
    maxWidth: 132,
    alignItems: "flex-end",
  },
  spendingEyebrow: {
    color: V4.textSecondary,
    fontWeight: "700",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  spendingAmount: { color: V4.green, fontWeight: "900", fontSize: 13, marginTop: 2 },
  spendingPlaceholder: { color: V4.textSecondary, fontWeight: "700", fontSize: 11, marginTop: 2 },
  accountMenu: {
    marginBottom: 12,
    borderRadius: V4_RADIUS.md,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 8,
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  menuItemText: { color: V4.textPrimary, fontWeight: "800" },
  menuItemDanger: { backgroundColor: "rgba(127,29,29,0.25)" },
  menuItemDangerText: { color: "#FCA5A5", fontWeight: "800" },
  softNoticeCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: V4_RADIUS.md,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
  },
  softNoticeTitle: { color: V4.textSecondary, fontWeight: "700", fontSize: 13 },
  unavailableCard: {
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 18,
    marginBottom: 12,
  },
  unavailableTitle: { color: V4.textPrimary, fontWeight: "800", fontSize: 15 },
  unavailableSub: { color: V4.textSecondary, fontSize: 13, marginTop: 6, fontWeight: "600" },
  warnBanner: {
    marginBottom: 12,
    padding: 14,
    borderRadius: V4_RADIUS.md,
    backgroundColor: "rgba(120,53,15,0.28)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
  },
  warnText: { color: "#FDE68A", fontWeight: "700" },
  areaCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: V4_RADIUS.md,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
  },
  areaCardTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 15 },
  areaCardSub: { color: V4.textSecondary, fontSize: 12, marginTop: 4, fontWeight: "600" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.lg,
    borderWidth: 1,
    borderColor: V4.border,
    paddingLeft: 14,
    paddingRight: 8,
    minHeight: 56,
    marginBottom: 12,
  },
  searchBarFocused: { borderColor: V4.borderGreen },
  searchIcon: { color: V4.textSecondary, fontSize: 18, marginRight: 8 },
  searchInput: { flex: 1, color: V4.textPrimary, fontSize: 15, fontWeight: "600" },
  filterButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
  },
  filterButtonText: { color: V4.bg, fontSize: 16, fontWeight: "900" },
  intelBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  intelPill: {
    flex: 1,
    backgroundColor: V4.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: V4.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 72,
  },
  intelPillAccent: {
    borderColor: V4.borderGreen,
    backgroundColor: "rgba(0,217,95,0.08)",
  },
  intelValue: { color: V4.textPrimary, fontWeight: "900", fontSize: 16 },
  intelValueAccent: { color: V4.green },
  intelLabel: { color: V4.textSecondary, fontSize: 10, fontWeight: "700", marginTop: 4 },
  intelDisclaimer: {
    color: V4.textSecondary,
    fontSize: 10,
    fontWeight: "600",
    marginTop: -6,
    marginBottom: 12,
    opacity: 0.85,
  },
  mapHero: {
    height: 196,
    borderRadius: V4_RADIUS.lg,
    overflow: "hidden",
    backgroundColor: "#081224",
    borderWidth: 1,
    borderColor: V4.border,
    marginBottom: 14,
    ...V4_SHADOW,
  },
  mapScene: { ...StyleSheet.absoluteFillObject },
  mapZoneA: {
    position: "absolute",
    left: "8%",
    top: "18%",
    width: "34%",
    height: "42%",
    borderRadius: 999,
    backgroundColor: "rgba(0,217,95,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,217,95,0.12)",
  },
  mapZoneB: {
    position: "absolute",
    right: "6%",
    top: "12%",
    width: "38%",
    height: "48%",
    borderRadius: 999,
    backgroundColor: "rgba(123,97,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(123,97,255,0.14)",
  },
  mapZoneC: {
    position: "absolute",
    left: "28%",
    bottom: "8%",
    width: "44%",
    height: "34%",
    borderRadius: 999,
    backgroundColor: "rgba(56,189,248,0.05)",
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.10)",
  },
  mapRoad: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  mapRoadH1: { left: "6%", right: "6%", top: "46%", height: 3, borderRadius: 2 },
  mapRoadH2: { left: "10%", right: "18%", top: "68%", height: 2, borderRadius: 2, opacity: 0.7 },
  mapRoadV1: { top: "12%", bottom: "18%", left: "52%", width: 3, borderRadius: 2 },
  mapRoadV2: { top: "18%", bottom: "28%", left: "28%", width: 2, borderRadius: 2, opacity: 0.75 },
  mapRoadGlow: {
    position: "absolute",
    backgroundColor: "rgba(0,217,95,0.35)",
    shadowColor: V4.green,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  mapRoadGlowH1: { left: "18%", right: "30%", top: "45%", height: 5, borderRadius: 3, opacity: 0.45 },
  mapRoadGlowV1: { top: "22%", bottom: "34%", left: "51%", width: 5, borderRadius: 3, opacity: 0.35 },
  mapIntersection: {
    position: "absolute",
    left: "49%",
    top: "44%",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  mapMarker: {
    position: "absolute",
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  mapMarkerGlyph: { fontSize: 9, fontWeight: "900" },
  mapMarkerFood: {
    left: "18%",
    top: "28%",
    backgroundColor: "rgba(0,217,95,0.18)",
    borderColor: "rgba(0,217,95,0.45)",
  },
  mapMarkerTaxi: {
    right: "22%",
    top: "22%",
    backgroundColor: "rgba(250,204,21,0.16)",
    borderColor: "rgba(250,204,21,0.42)",
  },
  mapMarkerDelivery: {
    right: "14%",
    bottom: "22%",
    backgroundColor: "rgba(123,97,255,0.18)",
    borderColor: "rgba(123,97,255,0.42)",
  },
  mapUserPulseOuter: {
    position: "absolute",
    left: "47%",
    top: "41%",
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(59,130,246,0.18)",
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.35)",
  },
  mapUserPulseInner: {
    position: "absolute",
    left: "49.2%",
    top: "43.2%",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#3B82F6",
    borderWidth: 2,
    borderColor: "#EFF6FF",
  },
  mapGlowDriverA: {
    position: "absolute",
    left: "24%",
    top: "58%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: V4.green,
    shadowColor: V4.green,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  mapGlowDriverB: {
    position: "absolute",
    right: "34%",
    top: "36%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: V4.green,
    shadowColor: V4.green,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  mapOverlayTop: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mapBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(5,11,24,0.82)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: V4.border,
  },
  mapBadgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: V4.green },
  mapBadgeText: { color: V4.textPrimary, fontSize: 11, fontWeight: "800", flexShrink: 1 },
  mapViewButton: {
    backgroundColor: "rgba(5,11,24,0.82)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: V4.border,
  },
  mapViewButtonText: { color: V4.textSecondary, fontSize: 11, fontWeight: "800" },
  mapOverlayBottom: {
    position: "absolute",
    left: 12,
    bottom: 12,
  },
  mapEta: { color: V4.textSecondary, fontSize: 11, fontWeight: "700" },
  heroCard: {
    borderRadius: V4_RADIUS.lg,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.borderGreen,
    padding: 16,
    marginBottom: 18,
    ...V4_SHADOW,
  },
  heroCardContent: { flexDirection: "row", alignItems: "center" },
  heroCardCopy: { flex: 1, paddingRight: 12 },
  heroEyebrow: { color: V4.green, fontWeight: "900", fontSize: 12, letterSpacing: 0.6 },
  heroTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 21, marginTop: 6, lineHeight: 27 },
  heroSubtitle: {
    color: V4.textSecondary,
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  heroCta: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: V4.textPrimary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroCtaText: { color: V4.bg, fontWeight: "900", fontSize: 12 },
  heroArt: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "rgba(0,217,95,0.12)",
    borderWidth: 1,
    borderColor: V4.borderGreen,
    alignItems: "center",
    justifyContent: "center",
  },
  heroArtGlyph: { color: V4.green, fontWeight: "900", fontSize: 16 },
  sectionTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 18, marginBottom: 12 },
  servicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  serviceCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 132,
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 14,
    ...V4_SHADOW,
  },
  serviceCardDisabled: { opacity: 0.55 },
  serviceGlyph: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  serviceGlyphText: { fontWeight: "900", fontSize: 12 },
  serviceTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 16 },
  serviceSub: { color: V4.textSecondary, fontSize: 12, marginTop: 4, fontWeight: "600" },
  moreCard: {
    backgroundColor: V4.cardSecondary,
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 14,
    marginBottom: 14,
  },
  moreCardTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 15 },
  moreCardSub: { color: V4.textSecondary, fontSize: 12, marginTop: 4 },
  quickRow: { gap: 8, paddingBottom: 14 },
  quickPill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
  },
  quickPillActive: {
    backgroundColor: "rgba(0,217,95,0.12)",
    borderColor: V4.borderGreen,
  },
  quickPillText: { color: V4.textSecondary, fontWeight: "800", fontSize: 12 },
  quickPillTextActive: { color: V4.green },
  rewardsCard: {
    flexDirection: "row",
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.lg,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 16,
    marginBottom: 14,
    ...V4_SHADOW,
  },
  rewardsLeft: { flex: 1, paddingRight: 12 },
  rewardsEyebrow: { color: V4.textSecondary, fontWeight: "800", fontSize: 11 },
  rewardsLevel: { color: V4.textPrimary, fontWeight: "900", fontSize: 22, marginTop: 4 },
  rewardsProgress: { color: V4.textSecondary, fontSize: 12, marginTop: 6, fontWeight: "600" },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: V4.green, borderRadius: 999 },
  rewardsLink: { color: V4.green, fontWeight: "900", fontSize: 12, marginTop: 10 },
  rewardsBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(123,97,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(123,97,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardsBadgeText: { color: V4.purple, fontWeight: "900", fontSize: 24 },
  promoCard: {
    flexDirection: "row",
    borderRadius: V4_RADIUS.lg,
    backgroundColor: "#121A35",
    borderWidth: 1,
    borderColor: "rgba(123,97,255,0.28)",
    padding: 16,
    marginBottom: 18,
    overflow: "hidden",
  },
  promoCopy: { flex: 1 },
  promoEyebrow: { color: V4.purple, fontWeight: "900", fontSize: 11 },
  promoTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 28, marginTop: 4 },
  promoSub: { color: V4.textSecondary, fontSize: 13, marginTop: 4, fontWeight: "600" },
  promoCta: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: V4.green,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  promoCtaText: { color: V4.bg, fontWeight: "900", fontSize: 12 },
  promoArt: {
    width: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  promoArtGlyph: { color: V4.green, fontWeight: "900", fontSize: 12 },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  viewAll: { color: V4.green, fontWeight: "900", fontSize: 13 },
  emptyCard: {
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 18,
    marginBottom: 12,
  },
  emptyTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 16 },
  emptySub: { color: V4.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 20 },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: V4.card,
    borderRadius: V4_RADIUS.md,
    borderWidth: 1,
    borderColor: V4.border,
    padding: 12,
    marginBottom: 10,
  },
  recentIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: V4.cardSecondary,
    borderWidth: 1,
    borderColor: V4.border,
    alignItems: "center",
    justifyContent: "center",
  },
  recentIconText: { color: V4.green, fontWeight: "900", fontSize: 12 },
  recentBody: { flex: 1, minWidth: 0, paddingHorizontal: 10 },
  recentTitle: { color: V4.textPrimary, fontWeight: "900", fontSize: 15 },
  recentMeta: { color: V4.textSecondary, fontSize: 11, marginTop: 2 },
  statusPill: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statusPillDone: { backgroundColor: "rgba(0,217,95,0.12)" },
  statusPillText: { color: V4.textSecondary, fontSize: 10, fontWeight: "800" },
  statusPillTextDone: { color: V4.green },
  recentRight: { alignItems: "flex-end", gap: 6 },
  recentAmount: { color: V4.textPrimary, fontWeight: "900", fontSize: 14 },
  chatButton: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(123,97,255,0.16)",
  },
  chatButtonText: { color: V4.purple, fontWeight: "900", fontSize: 10 },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    backgroundColor: "rgba(5,11,24,0.96)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 6,
    paddingTop: 8,
    minHeight: 72,
    ...V4_SHADOW,
  },
  bottomTab: { flex: 1, alignItems: "center", paddingHorizontal: 2, paddingBottom: 2 },
  bottomTabGlyph: { color: V4.textSecondary, fontSize: 16, fontWeight: "800" },
  bottomTabGlyphActive: { color: V4.green },
  bottomTabLabel: { color: V4.textSecondary, fontSize: 10, fontWeight: "700", marginTop: 2 },
  bottomTabLabelActive: { color: V4.green },
  aiButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    marginTop: -22,
    marginBottom: 2,
    backgroundColor: V4.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: V4.bg,
    ...V4_SHADOW,
  },
  aiButtonGlyph: { color: V4.bg, fontSize: 17, fontWeight: "900", marginTop: -6 },
  aiButtonLabel: {
    position: "absolute",
    bottom: 8,
    color: V4.bg,
    fontSize: 7,
    fontWeight: "900",
    width: 64,
    textAlign: "center",
  },
});
