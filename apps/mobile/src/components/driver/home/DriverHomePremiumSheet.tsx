import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Animated,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  MMD_BLUE,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../../theme/mmdUi";
import { formatHiddenEarningsLabel } from "../../../lib/driverActiveJobs";
import { useTranslation } from "react-i18next";

/** Figma Driver Home PremiumSheet — MMD_BLUE chrome (file m1YPra9RLUz38tGTPmYczj). */
const C = {
  sheet: MMD_BLUE,
  border: MMD_STROKE,
  text: MMD_WHITE,
  textMuted: MMD_TEXT_MUTED_BLUE,
  textSoft: "#94A3B8",
  green: MMD_TAXI_GREEN,
  navy: MMD_BLUE,
  purple: "#7C3AED",
  blue: "#93C5FD",
  red: "#DC2626",
  orange: "#EA580C",
  yellow: MMD_GOLD_CLASSIC,
  link: MMD_GOLD_CLASSIC,
  actionNavy: "#0037A0",
} as const;

export type PremiumJobKind = "taxi" | "food" | "delivery" | "other";

export type PremiumActiveJob = {
  id: string;
  key: string;
  kind: PremiumJobKind;
  kindLabel: string;
  statusLabel: string;
  pickup: string;
  dropoff: string;
  amountLabel: string;
  distanceLabel: string;
  etaLabel: string | null;
  onPress: () => void;
};

export type PremiumSheetStats = {
  todayEarningsLabel: string;
  tripsToday: number;
  points: number;
  level: string;
  nextLevel: string | null;
  levelProgress: number;
  pointsProgressLabel: string;
  nextRewardLabel: string;
};

export type PremiumZoneInfo = {
  areaLabel: string;
  activityLabel: string;
  activityDetail: string;
  driversNearby: number;
  driversDetail: string;
  requestsNearby: number;
  waitRangeLabel: string;
  waitDetail: string;
  earningsMultiplier: number | null;
};

export type PremiumSmartDispatch = {
  recommendation?: string;
  chips?: string[];
  status: "live" | "offline" | "quiet";
};

type Props = {
  isOnline: boolean;
  searchingSubtitle: string;
  smartDispatch?: PremiumSmartDispatch | null;
  zone: PremiumZoneInfo;
  stats: PremiumSheetStats;
  earningsHidden: boolean;
  onToggleEarningsHidden: () => void;
  onOpenEarnings: () => void;
  onViewHotspots: () => void;
  onViewAllJobs: () => void;
  onGoBusyArea: () => void;
  onGoOffline: () => void;
  onGoOnline: () => void;
  /** __DEV__ only — preview premium ONLINE UI without backend gates. */
  onForceOnlinePreview?: () => void;
  onRefreshJobs: () => void;
  jobs: PremiumActiveJob[];
  jobsLoading: boolean;
  jobsError: string | null;
  searchPulseStyle?: StyleProp<ViewStyle>;
  /** Clockwise radar: one full turn every 2s (driven by the parent animation). */
  radarSpinStyle?: StyleProp<ViewStyle>;
  bottomPadding: number;
};

function jobVisual(kind: PremiumJobKind): {
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
} {
  if (kind === "taxi") return { icon: "car-sport", bg: "rgba(212,175,55,0.2)", fg: MMD_GOLD_CLASSIC };
  if (kind === "food") return { icon: "restaurant", bg: "rgba(34,197,94,0.18)", fg: "#86EFAC" };
  if (kind === "delivery") return { icon: "bag-handle", bg: "rgba(34,197,94,0.18)", fg: "#86EFAC" };
  return { icon: "cube", bg: "rgba(170,190,230,0.16)", fg: C.textMuted };
}

export function DriverHomePremiumSheet({
  isOnline,
  searchingSubtitle,
  smartDispatch: _smartDispatch,
  zone: _zone,
  stats,
  earningsHidden,
  onToggleEarningsHidden,
  onOpenEarnings,
  onViewHotspots: _onViewHotspots,
  onViewAllJobs,
  onGoBusyArea,
  onGoOffline,
  onGoOnline,
  onForceOnlinePreview,
  onRefreshJobs,
  jobs,
  jobsLoading,
  jobsError,
  searchPulseStyle: _searchPulseStyle,
  radarSpinStyle,
  bottomPadding,
}: Props) {
  const { t } = useTranslation();
  const jobsTitle = t("driver.home.premium.activeJobs", { count: jobs.length });
  const valueStyle = [styles.statValue, isOnline ? styles.statValueOnline : null];

  const summaryBlock = (
    <View style={styles.summaryBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t("driver.home.premium.todaySummary")}</Text>
        <TouchableOpacity onPress={onOpenEarnings} style={styles.linkRow} activeOpacity={0.85}>
          <Text style={styles.linkText}>{t("driver.home.premium.viewDetails")}</Text>
          <Ionicons name="chevron-forward" size={13} color={C.link} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.statCol}>
          <Text style={[valueStyle, isOnline ? styles.statEarningsOnline : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {formatHiddenEarningsLabel(earningsHidden, stats.todayEarningsLabel)}
          </Text>
          <View style={styles.earningsLabelRow}>
            <Text style={styles.statLabel}>{t("driver.home.premium.earnings")}</Text>
            <TouchableOpacity onPress={onToggleEarningsHidden} hitSlop={8} accessibilityRole="button">
              <Ionicons name={earningsHidden ? "eye-off" : "eye"} size={14} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.statCol}>
          <Text style={valueStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{stats.tripsToday}</Text>
          <Text style={styles.statLabel}>{t("driver.home.premium.trips")}</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={valueStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{Math.round(stats.points).toLocaleString()}</Text>
          <Text style={styles.statLabel}>{t("driver.home.premium.points")}</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={valueStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {stats.level}
          </Text>
          <Text style={styles.statLabel}>{t("driver.home.premium.level")}</Text>
        </View>
      </View>
    </View>
  );

  const jobsBlock = (
    <View style={styles.jobsBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{jobsTitle}</Text>
        {jobs.length === 0 ? (
          <Text style={styles.emptyTitleInline} numberOfLines={2}>
            {t("driver.home.premium.noMission")}
          </Text>
        ) : (
          <TouchableOpacity onPress={onViewAllJobs} style={styles.linkRow} activeOpacity={0.85}>
            <Text style={styles.linkText}>{t("driver.home.premium.viewAll")}</Text>
            <Ionicons name="chevron-forward" size={13} color={C.link} />
          </TouchableOpacity>
        )}
      </View>

      {jobsLoading ? <ActivityIndicator color={C.green} style={{ marginVertical: 10 }} /> : null}
      {jobsError ? <Text style={styles.errorText}>{jobsError}</Text> : null}

      {jobs.length === 0 && !jobsLoading ? (
        <TouchableOpacity style={styles.emptyBox} activeOpacity={0.88} onPress={onRefreshJobs}>
          <Text style={styles.emptySub}>{t("driver.home.premium.noMissionBody")}</Text>
        </TouchableOpacity>
      ) : (
        jobs.map((item) => {
          const visual = jobVisual(item.kind);
          return (
            <TouchableOpacity
              key={item.key}
              style={styles.jobCard}
              activeOpacity={0.88}
              onPress={item.onPress}
            >
              <View style={[styles.jobIcon, { backgroundColor: visual.bg }]}>
                <Ionicons name={visual.icon} size={18} color={visual.fg} />
              </View>
              <View style={styles.jobBody}>
                <Text style={styles.jobKind}>{item.kindLabel}</Text>
                <Text style={styles.jobLine} numberOfLines={1}>
                  {item.kind === "food"
                    ? t("driver.home.premium.restaurantLine", { address: item.pickup })
                    : t("driver.home.premium.pickupLine", { address: item.pickup })}
                </Text>
                <Text style={styles.jobLine} numberOfLines={1}>
                  {item.kind === "food"
                    ? t("driver.home.premium.customerLine", { address: item.dropoff })
                    : t("driver.home.premium.destinationLine", { address: item.dropoff })}
                </Text>
              </View>
              <View style={styles.jobRight}>
                <Text style={styles.jobAmount}>{item.amountLabel}</Text>
                <Text style={styles.jobMeta}>
                  {[item.etaLabel, item.distanceLabel].filter(Boolean).join(" / ")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.textSoft} />
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  if (!isOnline) {
    return (
      <View style={[styles.sheet, isOnline ? styles.sheetOnline : null, { paddingBottom: Math.max(bottomPadding, 12) }]}>
        <View style={styles.handle} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          nestedScrollEnabled
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.offlineCard}>
            <TouchableOpacity
              activeOpacity={1}
              delayLongPress={700}
              onLongPress={__DEV__ ? onForceOnlinePreview : undefined}
              style={styles.offlineLogoBox}
            >
              <Image
                source={require("../../../../assets/brand/mmd-logo-ui.png")}
                style={styles.offlineLogo}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <Text style={styles.offlineTitle}>{t("driver.home.premium.youreOffline")}</Text>
            <Text style={styles.offlineSub}>{t("driver.home.premium.offlineBody")}</Text>
            <TouchableOpacity style={styles.offlineCta} activeOpacity={0.9} onPress={onGoOnline}>
              <Text style={styles.offlineCtaText}>{t("driver.home.premium.goOnline")}</Text>
            </TouchableOpacity>
          </View>
          {summaryBlock}
          {jobsBlock}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.sheet, isOnline ? styles.sheetOnline : null, { paddingBottom: Math.max(bottomPadding, 12) }]}>
      <View style={styles.handle} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled
        contentContainerStyle={styles.scrollContent}
      >
        <LinearGradient
          colors={["#082F49", "#0F172A"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.nextRideCard}
        >
          <View style={styles.nextRideCopy}>
            <Text style={styles.nextRideTitle}>{t("driver.home.premium.nextRideTitle")}</Text>
            <Text style={styles.nextRideSub} numberOfLines={3}>
              {searchingSubtitle}
            </Text>
            <Text style={styles.nextRideStatus}>{t("driver.home.premium.nextRideStatus")}</Text>
          </View>
          <View style={styles.radarHost}>
            <Animated.View style={[styles.radarSpin, radarSpinStyle]}>
              <View style={styles.radarRingRed} />
              <View style={styles.radarRingYellow} />
              <View style={styles.radarRingGreen} />
            </Animated.View>
            <View style={styles.radarCore} />
          </View>
        </LinearGradient>

        {summaryBlock}
        {jobsBlock}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.primaryAction} activeOpacity={0.9} onPress={onGoBusyArea}>
            <View style={styles.actionTextCol}>
              <Text style={styles.primaryActionTitle} numberOfLines={2}>{t("driver.home.premium.goBusyArea")}</Text>
              <Text style={styles.primaryActionSub} numberOfLines={2}>{t("driver.home.premium.goBusyAreaSub")}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction} activeOpacity={0.9} onPress={onGoOffline}>
            <View style={styles.actionTextCol}>
              <Text style={styles.secondaryActionTitle} numberOfLines={2}>{t("driver.home.premium.goOffline")}</Text>
              <Text style={styles.secondaryActionSub} numberOfLines={2}>{t("driver.home.premium.goOfflineSub")}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 6,
    maxHeight: "100%",
  },
  sheetOnline: {
    maxHeight: "52%",
  },
  handle: {
    alignSelf: "flex-start",
    marginLeft: 14,
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: MMD_BLUE,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },

  smartCard: {
    backgroundColor: MMD_BLUE,
    borderRadius: 18,
    marginBottom: 10,
    overflow: "hidden",
    minHeight: 88,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  smartBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: MMD_BLUE,
  },
  smartGradientTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "45%",
    backgroundColor: "rgba(0,51,153,0.35)",
  },
  smartGradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "72%",
    backgroundColor: "rgba(0,55,160,0.25)",
  },
  smartGlowCyan: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 280,
    height: 190,
    borderRadius: 140,
    backgroundColor: "rgba(34,211,238,0.12)",
  },
  smartGlowPurple: {
    position: "absolute",
    left: -8,
    bottom: -14,
    width: 250,
    height: 180,
    borderRadius: 125,
    backgroundColor: "rgba(168,85,247,0.14)",
  },
  smartGlowBlueMid: {
    position: "absolute",
    left: "6%",
    right: "6%",
    bottom: 0,
    height: 140,
    borderRadius: 90,
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  smartGlowLive: { opacity: 1 },
  smartWaveImage: {
    position: "absolute",
    left: -20,
    right: -20,
    bottom: -2,
    height: 88,
    opacity: 0.35,
  },
  smartWaveImageSoft: {
    position: "absolute",
    left: -8,
    right: -8,
    bottom: 12,
    height: 64,
    opacity: 0.2,
  },
  smartWaveRibbonHost: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 4,
    height: 58,
  },
  smartWaveNode: {
    position: "absolute",
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  smartContent: {
    position: "relative",
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 12,
    zIndex: 2,
  },
  smartTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoBox: {
    width: 44,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.45)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 28, height: 28, borderRadius: 14 },
  smartMid: { flex: 1, minWidth: 0 },
  smartTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smartTitle: {
    color: MMD_WHITE,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  livePill: {
    backgroundColor: "#7C3AED",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    minHeight: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  livePillOff: {
    backgroundColor: "rgba(148,163,184,0.55)",
  },
  liveText: {
    color: MMD_WHITE,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.55,
  },
  smartSubtitle: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "400",
    marginTop: 4,
    lineHeight: 14.5,
  },
  hotspotsBtn: {
    borderRadius: 999,
    backgroundColor: "rgba(0,51,153,0.55)",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 9,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    alignSelf: "center",
    maxWidth: 104,
  },
  hotspotsText: {
    color: MMD_TEXT,
    fontSize: 10,
    fontWeight: "700",
  },

  offlineCard: {
    backgroundColor: MMD_BLUE,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 8,
  },
  offlineLogoBox: {
    width: 48,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.45)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  offlineLogo: { width: 30, height: 30, borderRadius: 15 },
  offlineTitle: {
    color: MMD_WHITE,
    fontSize: 17,
    fontWeight: "800",
  },
  offlineSub: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 17,
    marginBottom: 4,
  },
  offlineCta: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.green,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 22,
    height: 48,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  offlineCtaText: { color: MMD_WHITE, fontSize: 15, fontWeight: "800" },

  intelStrip: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 12,
    backgroundColor: MMD_BLUE,
  },
  intelCell: { flex: 1, paddingHorizontal: 4, gap: 2, alignItems: "center" },
  intelDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginVertical: 2,
  },
  intelLabel: { color: MMD_TEXT_MUTED_BLUE, fontSize: 9, fontWeight: "600", marginTop: 2 },
  intelValue: { color: MMD_WHITE, fontSize: 11, fontWeight: "800", textAlign: "center" },
  intelDetail: { color: "#94A3B8", fontSize: 9, fontWeight: "600", textAlign: "center" },

  intelRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
  },
  intelCard: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 2,
    minHeight: 88,
  },

  summaryBlock: { marginBottom: 14 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: { color: MMD_WHITE, fontSize: 15, fontWeight: "800" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  linkText: { color: C.link, fontSize: 12, fontWeight: "700" },
  summaryStats: { flexDirection: "row", marginBottom: 12, gap: 8 },
  statCol: { flex: 1, alignItems: "center", gap: 4 },
  statCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statGlyph: { fontSize: 16, fontWeight: "900" },
  statValue: { color: MMD_WHITE, fontSize: 13, fontWeight: "800", textAlign: "center" },
  statValueOnline: { fontSize: 16 },
  statEarningsOnline: { fontSize: 19 },
  earningsLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  statLabel: { color: MMD_TEXT_MUTED_BLUE, fontSize: 10, fontWeight: "600", textAlign: "center" },
  emptyTitleInline: {
    color: MMD_WHITE,
    fontSize: 11,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
    maxWidth: "58%",
  },
  nextRideCard: {
    borderRadius: 18,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  nextRideCopy: { flex: 1, minWidth: 0 },
  nextRideTitle: { color: "#F8FAFC", fontSize: 17, fontWeight: "800", lineHeight: 22 },
  nextRideSub: { color: "#93C5FD", fontSize: 11, fontWeight: "600", marginTop: 6, lineHeight: 15 },
  nextRideStatus: {
    color: "#A78BFA",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 8,
    letterSpacing: 0.4,
  },
  radarHost: { width: 84, height: 84, alignItems: "center", justifyContent: "center" },
  radarSpin: { width: 78, height: 78, alignItems: "center", justifyContent: "center" },
  radarRingRed: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "#EF4444",
    borderBottomColor: "transparent",
  },
  radarRingYellow: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    borderColor: "#EAB308",
    borderLeftColor: "transparent",
  },
  radarRingGreen: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: "#22C55E",
    borderRightColor: "transparent",
  },
  radarCore: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#22C55E",
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  progressPts: { color: MMD_TEXT_MUTED_BLUE, fontSize: 11, fontWeight: "600" },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.28)",
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: C.green,
  },
  nextRewardCard: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: MMD_BLUE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nextRewardEyebrow: { color: MMD_TEXT_MUTED_BLUE, fontSize: 12, fontWeight: "500" },
  nextRewardValue: { color: C.link, fontSize: 13, fontWeight: "800" },

  jobsBlock: { marginBottom: 14 },
  errorText: { color: C.red, fontSize: 12, marginBottom: 6 },
  emptyBox: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
  },
  emptyTitle: { color: MMD_WHITE, fontSize: 13, fontWeight: "700" },
  emptySub: { color: MMD_TEXT_MUTED_BLUE, fontSize: 11, marginTop: 4, textAlign: "center" },
  jobCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    backgroundColor: MMD_BLUE,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  jobIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  jobBody: { flex: 1, minWidth: 0 },
  jobKind: { color: MMD_WHITE, fontSize: 13, fontWeight: "800", marginBottom: 2 },
  jobLine: { color: MMD_TEXT_MUTED_BLUE, fontSize: 11, marginTop: 1 },
  jobRight: { alignItems: "flex-end", marginRight: 2 },
  jobAmount: { color: MMD_WHITE, fontSize: 14, fontWeight: "800" },
  jobMeta: { color: "#94A3B8", fontSize: 11, fontWeight: "600", marginTop: 2 },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 6 },
  primaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.actionNavy,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: MMD_BLUE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionTextCol: { flex: 1 },
  primaryActionTitle: { color: MMD_WHITE, fontSize: 14, fontWeight: "800", flexShrink: 1 },
  primaryActionSub: {
    color: "#DCFCE7",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  secondaryActionTitle: { color: C.red, fontSize: 14, fontWeight: "800" },
  secondaryActionSub: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
});
