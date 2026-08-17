import React, { useMemo } from "react";
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

/** Fixed copy — live metrics live only in the intel strip below. */
const SMART_DISPATCH_MESSAGE =
  "MMD analyzes demand in real time to surface the best opportunities nearby.";

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
  radarPulseStyle?: StyleProp<ViewStyle>;
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

/** Mockup-style luminous multi-layer backdrop + full-width pulse wave. */
function SmartDispatchBackdrop({ live }: { live: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.smartBase} />
      <View style={styles.smartGradientTop} />
      <View style={styles.smartGradientBottom} />
      <View style={[styles.smartGlowCyan, live ? styles.smartGlowLive : null]} />
      <View style={[styles.smartGlowPurple, live ? styles.smartGlowLive : null]} />
      <View style={styles.smartGlowBlueMid} />
      <Image
        source={require("../../../../assets/brand/smart-dispatch-wave.png")}
        style={styles.smartWaveImage}
        resizeMode="cover"
      />
      <Image
        source={require("../../../../assets/brand/smart-dispatch-wave.png")}
        style={styles.smartWaveImageSoft}
        resizeMode="cover"
      />
      <View style={styles.smartWaveRibbonHost}>
        {[
          { x: 0.08, y: 22, c: "#67E8F9", s: "#22D3EE" },
          { x: 0.2, y: 34, c: "#A5B4FC", s: "#818CF8" },
          { x: 0.34, y: 14, c: "#C084FC", s: "#A855F7" },
          { x: 0.48, y: 30, c: "#67E8F9", s: "#22D3EE" },
          { x: 0.62, y: 18, c: "#E879F9", s: "#D946EF" },
          { x: 0.76, y: 32, c: "#67E8F9", s: "#22D3EE" },
          { x: 0.9, y: 16, c: "#C084FC", s: "#A855F7" },
        ].map((n, i) => (
          <View
            key={`node-${i}`}
            style={[
              styles.smartWaveNode,
              {
                left: `${n.x * 100}%`,
                bottom: n.y,
                backgroundColor: n.c,
                shadowColor: n.s,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export function DriverHomePremiumSheet({
  isOnline,
  searchingSubtitle: _searchingSubtitle,
  smartDispatch: _smartDispatch,
  zone,
  stats,
  earningsHidden,
  onToggleEarningsHidden,
  onOpenEarnings,
  onViewHotspots,
  onViewAllJobs,
  onGoBusyArea,
  onGoOffline,
  onGoOnline,
  onForceOnlinePreview,
  onRefreshJobs,
  jobs,
  jobsLoading,
  jobsError,
  searchPulseStyle,
  radarPulseStyle,
  bottomPadding,
}: Props) {
  const progressPct = Math.round(Math.max(0, Math.min(1, stats.levelProgress)) * 100);
  const jobsTitle = useMemo(() => `Active jobs (${jobs.length})`, [jobs.length]);

  const summaryBlock = (
    <View style={styles.summaryBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Today's summary</Text>
        <TouchableOpacity onPress={onOpenEarnings} style={styles.linkRow} activeOpacity={0.85}>
          <Text style={styles.linkText}>View details</Text>
          <Ionicons name="chevron-forward" size={13} color={C.link} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.statCol}>
          <Text style={styles.statValue} numberOfLines={1}>
            {formatHiddenEarningsLabel(earningsHidden, stats.todayEarningsLabel)}
          </Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{stats.tripsToday}</Text>
          <Text style={styles.statLabel}>Trips</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{Math.round(stats.points).toLocaleString()}</Text>
          <Text style={styles.statLabel}>Points</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statValue} numberOfLines={1}>
            {stats.level}
          </Text>
          <Text style={styles.statLabel}>Level</Text>
        </View>
      </View>

      <View style={styles.progressHeader}>
        <Text style={styles.progressPts}>{stats.pointsProgressLabel}</Text>
        <TouchableOpacity onPress={onToggleEarningsHidden} hitSlop={8}>
          <Ionicons name={earningsHidden ? "eye-off" : "eye"} size={15} color={C.textMuted} />
        </TouchableOpacity>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>

      <TouchableOpacity style={styles.nextRewardCard} activeOpacity={0.88} onPress={onOpenEarnings}>
        <Text style={styles.nextRewardEyebrow}>Next reward</Text>
        <View style={styles.linkRow}>
          <Text style={styles.nextRewardValue} numberOfLines={1}>
            {stats.nextRewardLabel}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={C.link} />
        </View>
      </TouchableOpacity>
    </View>
  );

  const jobsBlock = (
    <View style={styles.jobsBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{jobsTitle}</Text>
        <TouchableOpacity
          onPress={jobs.length > 0 ? onViewAllJobs : onRefreshJobs}
          style={styles.linkRow}
          activeOpacity={0.85}
        >
          <Text style={styles.linkText}>{jobs.length > 0 ? "View all" : "Refresh"}</Text>
          <Ionicons name="chevron-forward" size={13} color={C.link} />
        </TouchableOpacity>
      </View>

      {jobsLoading ? <ActivityIndicator color={C.green} style={{ marginVertical: 10 }} /> : null}
      {jobsError ? <Text style={styles.errorText}>{jobsError}</Text> : null}

      {jobs.length === 0 && !jobsLoading ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No active mission yet</Text>
          <Text style={styles.emptySub}>
            Accepted Taxi, Food, and Delivery jobs appear here.
          </Text>
        </View>
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
                  {item.kind === "food" ? "Restaurant" : "Pickup"}: {item.pickup}
                </Text>
                <Text style={styles.jobLine} numberOfLines={1}>
                  {item.kind === "food" ? "Customer" : "Destination"}: {item.dropoff}
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
      <View style={[styles.sheet, { paddingBottom: Math.max(bottomPadding, 12) }]}>
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
            <Text style={styles.offlineTitle}>You're offline</Text>
            <Text style={styles.offlineSub}>
              Go online to receive requests, see live demand hotspots, and unlock MMD Smart
              Dispatch.
            </Text>
            <TouchableOpacity style={styles.offlineCta} activeOpacity={0.9} onPress={onGoOnline}>
              <Text style={styles.offlineCtaText}>Go online</Text>
            </TouchableOpacity>
          </View>
          {summaryBlock}
          {jobsBlock}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(bottomPadding, 12) }]}>
      <View style={styles.handle} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled
        contentContainerStyle={styles.scrollContent}
      >
        {/* Smart Dispatch — brand card only; live metrics live in intel strip */}
        <Animated.View style={[styles.smartCard, searchPulseStyle]}>
          <SmartDispatchBackdrop live />
          <View style={styles.smartContent}>
            <View style={styles.smartTop}>
              <Animated.View style={[styles.logoBox, radarPulseStyle]}>
                <Image
                  source={require("../../../../assets/brand/mmd-logo-ui.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </Animated.View>
              <View style={styles.smartMid}>
                <View style={styles.smartTitleRow}>
                  <Text style={styles.smartTitle} numberOfLines={1}>
                    MMD Smart Dispatch
                  </Text>
                  <View style={styles.livePill}>
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                </View>
                <Text style={styles.smartSubtitle} numberOfLines={2}>
                  {SMART_DISPATCH_MESSAGE}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onViewHotspots}
                activeOpacity={0.88}
                style={styles.hotspotsBtn}
              >
                <Text style={styles.hotspotsText}>View Hotspots</Text>
                <Ionicons name="chevron-forward" size={12} color="#F8FAFC" />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        <View style={styles.intelStrip}>
          <View style={styles.intelCell}>
            <Ionicons name="cellular" size={13} color={C.red} />
            <Text style={styles.intelLabel}>High demand</Text>
            <Text style={styles.intelValue} numberOfLines={2}>
              {zone.activityLabel}
            </Text>
            <Text style={styles.intelDetail} numberOfLines={1}>
              {zone.activityDetail}
            </Text>
          </View>
          <View style={styles.intelDivider} />
          <View style={styles.intelCell}>
            <Ionicons name="person" size={13} color={C.green} />
            <Text style={styles.intelLabel}>Drivers nearby</Text>
            <Text style={styles.intelValue} numberOfLines={2}>
              {zone.driversNearby} {zone.driversNearby === 1 ? "driver" : "drivers"}
            </Text>
            <Text style={styles.intelDetail} numberOfLines={1}>
              {zone.driversDetail}
            </Text>
          </View>
          <View style={styles.intelDivider} />
          <View style={styles.intelCell}>
            <Ionicons name="time" size={13} color={C.purple} />
            <Text style={styles.intelLabel}>Est. wait</Text>
            <Text style={styles.intelValue} numberOfLines={2}>
              {zone.waitRangeLabel}
            </Text>
            <Text style={styles.intelDetail} numberOfLines={1}>
              {zone.waitDetail}
            </Text>
          </View>
          <View style={styles.intelDivider} />
          <View style={styles.intelCell}>
            <Ionicons name="chatbubble" size={13} color={C.blue} />
            <Text style={styles.intelLabel}>Requests nearby</Text>
            <Text style={styles.intelValue} numberOfLines={2}>
              {zone.requestsNearby}{" "}
              {zone.requestsNearby === 1 ? "request" : "requests"}
            </Text>
            <Text style={styles.intelDetail} numberOfLines={1}>
              {zone.areaLabel}
            </Text>
          </View>
        </View>

        {summaryBlock}
        {jobsBlock}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.primaryAction} activeOpacity={0.9} onPress={onGoBusyArea}>
            <View style={styles.actionTextCol}>
              <Text style={styles.primaryActionTitle}>Go to busy area</Text>
              <Text style={styles.primaryActionSub}>Navigate to high demand zone</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction} activeOpacity={0.9} onPress={onGoOffline}>
            <View style={styles.actionTextCol}>
              <Text style={styles.secondaryActionTitle}>Go offline</Text>
              <Text style={styles.secondaryActionSub}>You will stop receiving requests</Text>
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
  statValue: { color: MMD_WHITE, fontSize: 13, fontWeight: "800" },
  statLabel: { color: MMD_TEXT_MUTED_BLUE, fontSize: 10, fontWeight: "600" },
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

  actionsRow: { flexDirection: "column", gap: 8, marginTop: 4, marginBottom: 6 },
  primaryAction: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.actionNavy,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: MMD_BLUE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionTextCol: { flex: 1 },
  primaryActionTitle: { color: MMD_WHITE, fontSize: 14, fontWeight: "800" },
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
