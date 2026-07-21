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

const C = {
  sheet: "#FFFFFF",
  border: "#E8EAEF",
  text: "#0F172A",
  textMuted: "#64748B",
  textSoft: "#94A3B8",
  green: "#16A34A",
  navy: "#0B1220",
  purple: "#7C3AED",
  blue: "#2563EB",
  red: "#DC2626",
  orange: "#EA580C",
  yellow: "#CA8A04",
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
  if (kind === "taxi") return { icon: "car-sport", bg: "#FEF3C7", fg: "#B45309" };
  if (kind === "food") return { icon: "restaurant", bg: "#DCFCE7", fg: "#166534" };
  if (kind === "delivery") return { icon: "bag-handle", bg: "#DCFCE7", fg: "#166534" };
  return { icon: "cube", bg: "#F3F4F6", fg: C.textMuted };
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
          <Ionicons name="chevron-forward" size={13} color={C.green} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.statCol}>
          <View style={[styles.statCircle, { backgroundColor: "#DCFCE7" }]}>
            <Text style={[styles.statGlyph, { color: C.green }]}>$</Text>
          </View>
          <Text style={styles.statValue} numberOfLines={1}>
            {earningsHidden ? "••••" : stats.todayEarningsLabel}
          </Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
        <View style={styles.statCol}>
          <View style={[styles.statCircle, { backgroundColor: "#DBEAFE" }]}>
            <Ionicons name="bag-handle" size={15} color={C.blue} />
          </View>
          <Text style={styles.statValue}>{stats.tripsToday}</Text>
          <Text style={styles.statLabel}>Trips</Text>
        </View>
        <View style={styles.statCol}>
          <View style={[styles.statCircle, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="star" size={15} color={C.yellow} />
          </View>
          <Text style={styles.statValue}>{Math.round(stats.points).toLocaleString()}</Text>
          <Text style={styles.statLabel}>Points</Text>
        </View>
        <View style={styles.statCol}>
          <View style={[styles.statCircle, { backgroundColor: "#FFEDD5" }]}>
            <Ionicons name="medal" size={15} color={C.orange} />
          </View>
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
          <Ionicons name="chevron-forward" size={13} color={C.green} />
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
          <Ionicons name="chevron-forward" size={13} color={C.green} />
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
                source={require("../../../../assets/brand/mmd-logo.png")}
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
              <Ionicons name="radio-button-on" size={18} color="#FFFFFF" />
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
                  source={require("../../../../assets/brand/mmd-logo.png")}
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
            <Ionicons name="navigate" size={18} color="#FFFFFF" />
            <View style={styles.actionTextCol}>
              <Text style={styles.primaryActionTitle}>Go to busy area</Text>
              <Text style={styles.primaryActionSub}>Navigate to high demand zone</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction} activeOpacity={0.9} onPress={onGoOffline}>
            <Ionicons name="pause" size={18} color="#334155" />
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
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -3 },
    elevation: 16,
    maxHeight: "100%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#D1D5DB",
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },

  smartCard: {
    backgroundColor: "#020617",
    borderRadius: 18,
    marginBottom: 10,
    overflow: "hidden",
    minHeight: 108,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.2)",
  },
  smartBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#020617",
  },
  smartGradientTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "45%",
    backgroundColor: "rgba(15,23,42,0.7)",
  },
  smartGradientBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "72%",
    backgroundColor: "rgba(30,64,175,0.3)",
  },
  smartGlowCyan: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 280,
    height: 190,
    borderRadius: 140,
    backgroundColor: "rgba(34,211,238,0.42)",
  },
  smartGlowPurple: {
    position: "absolute",
    left: -8,
    bottom: -14,
    width: 250,
    height: 180,
    borderRadius: 125,
    backgroundColor: "rgba(168,85,247,0.44)",
  },
  smartGlowBlueMid: {
    position: "absolute",
    left: "6%",
    right: "6%",
    bottom: 0,
    height: 140,
    borderRadius: 90,
    backgroundColor: "rgba(59,130,246,0.34)",
  },
  smartGlowLive: { opacity: 1 },
  smartWaveImage: {
    position: "absolute",
    left: -20,
    right: -20,
    bottom: -2,
    height: 88,
    opacity: 1,
  },
  smartWaveImageSoft: {
    position: "absolute",
    left: -8,
    right: -8,
    bottom: 12,
    height: 64,
    opacity: 0.5,
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
    paddingTop: 11,
    paddingBottom: 32,
    paddingHorizontal: 12,
    zIndex: 2,
  },
  smartTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 56, height: 56 },
  smartMid: { flex: 1, minWidth: 0 },
  smartTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smartTitle: {
    color: "#FFFFFF",
    fontSize: 13.5,
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
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.55,
  },
  smartSubtitle: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 14.5,
  },
  hotspotsBtn: {
    borderRadius: 999,
    backgroundColor: "rgba(2,6,23,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(241,245,249,0.7)",
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
    color: "#F8FAFC",
    fontSize: 10.5,
    fontWeight: "700",
  },

  offlineCard: {
    backgroundColor: "#0B1220",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  offlineLogoBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 10,
  },
  offlineLogo: { width: 60, height: 60 },
  offlineTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 5,
  },
  offlineSub: {
    color: "#CBD5E1",
    fontSize: 12.5,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 17,
    marginBottom: 14,
  },
  offlineCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.green,
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 13,
    minHeight: 50,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  offlineCtaText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },

  intelStrip: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingVertical: 10,
    marginBottom: 12,
  },
  intelCell: { flex: 1, paddingHorizontal: 3, gap: 2 },
  intelDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginVertical: 2,
  },
  intelLabel: { color: C.textSoft, fontSize: 9, fontWeight: "600", marginTop: 2 },
  intelValue: { color: C.text, fontSize: 11, fontWeight: "800" },
  intelDetail: { color: C.textMuted, fontSize: 9, fontWeight: "500" },

  intelRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
  },
  intelCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
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
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  linkText: { color: C.green, fontSize: 12, fontWeight: "700" },
  summaryStats: { flexDirection: "row", marginBottom: 12, gap: 4 },
  statCol: { flex: 1, alignItems: "center", gap: 4 },
  statCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statGlyph: { fontSize: 16, fontWeight: "900" },
  statValue: { color: C.text, fontSize: 12, fontWeight: "800" },
  statLabel: { color: C.textMuted, fontSize: 10, fontWeight: "600" },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  progressPts: { color: C.textMuted, fontSize: 11, fontWeight: "600" },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: C.green,
  },
  nextRewardCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nextRewardEyebrow: { color: C.textMuted, fontSize: 12, fontWeight: "500" },
  nextRewardValue: { color: C.green, fontSize: 13, fontWeight: "800" },

  jobsBlock: { marginBottom: 14 },
  errorText: { color: C.red, fontSize: 12, marginBottom: 6 },
  emptyBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#F8FAFC",
  },
  emptyTitle: { color: C.text, fontSize: 13, fontWeight: "800" },
  emptySub: { color: C.textMuted, fontSize: 12, marginTop: 4 },
  jobCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "#FFFFFF",
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
  jobKind: { color: C.text, fontSize: 13, fontWeight: "800", marginBottom: 2 },
  jobLine: { color: C.textMuted, fontSize: 11, marginTop: 1 },
  jobRight: { alignItems: "flex-end", marginRight: 2 },
  jobAmount: { color: C.text, fontSize: 14, fontWeight: "800" },
  jobMeta: { color: C.textSoft, fontSize: 11, fontWeight: "600", marginTop: 2 },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 6 },
  primaryAction: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.green,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 72,
  },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F1F5F9",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 72,
  },
  actionTextCol: { flex: 1 },
  primaryActionTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  primaryActionSub: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
    lineHeight: 13,
  },
  secondaryActionTitle: { color: C.text, fontSize: 13, fontWeight: "800" },
  secondaryActionSub: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
    lineHeight: 13,
  },
});
