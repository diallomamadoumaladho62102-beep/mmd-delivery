// apps/mobile/src/screens/DriverMenuScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";
import ScreenHeader from "../components/navigation/ScreenHeader";

type MenuIconName =
  | "gift"
  | "spark"
  | "shield"
  | "wallet"
  | "account"
  | "card"
  | "help"
  | "profile";

type MenuItemProps = {
  label: string;
  onPress?: () => void;
  badge?: boolean;
  icon: MenuIconName;
  subtitle?: string;
};

const BG = "#020617";
const CARD = "rgba(15,23,42,0.86)";
const CARD_2 = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const PURPLE_DARK = "#8B5CF6";
const GREEN = "#22C55E";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

function MenuItem({ label, onPress, badge, icon, subtitle }: MenuItemProps) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.menuItem} activeOpacity={0.84}>
      <View style={styles.menuLeft}>
        <View style={styles.menuIconBox}>
          <MenuIcon name={icon} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.menuLabel}>{label}</Text>
          {subtitle ? <Text style={styles.menuSub}>{subtitle}</Text> : null}
        </View>
      </View>

      <View style={styles.menuRight}>
        {badge ? <View style={styles.dotBadge} /> : null}
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

function makeAvatarUri(name: string) {
  const safe = encodeURIComponent(name || "Driver");
  return `https://ui-avatars.com/api/?name=${safe}&background=111827&color=fff&size=128`;
}

function StarsRow({
  rating,
  count,
  size = 14,
}: {
  rating: number | null | undefined;
  count: number;
  size?: number;
}) {
  if (!count) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
          {"☆".repeat(5)}
        </Text>
      </View>
    );
  }

  const value =
    rating == null || !Number.isFinite(rating)
      ? 0
      : Math.max(0, Math.min(5, rating));

  const full = Math.floor(value);
  const half = value - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>
        {"★".repeat(full)}
      </Text>
      {half ? (
        <Text style={{ color: "#FBBF24", fontSize: size, fontWeight: "900" }}>
          ½
        </Text>
      ) : null}
      <Text style={{ color: "#374151", fontSize: size, fontWeight: "900" }}>
        {"☆".repeat(empty)}
      </Text>
    </View>
  );
}

// ---------- Dates helpers (pour tips semaine) ----------
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeekMonday(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday=0
  x.setDate(x.getDate() - diff);
  return x;
}

function toNumber(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n: number) {
  const x = toNumber(n);
  return `${x.toFixed(2)} $`;
}

// ✅ Avatar helpers
const AVATARS_BUCKET = "avatars"; // public

function withCacheBuster(url: string, buster: string | number) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(buster))}`;
}

function getPublicAvatarUrl(path: string) {
  const pub = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return pub.data.publicUrl ?? null;
}

export function DriverMenuScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation(); // ✅ important: re-render on language change
  void i18n.language; // (petit guard pour s'assurer que le screen se re-render)

  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);

  // ✅ fallback dynamique (change quand la langue change)
  const driverLabelFallback = useMemo(
    () => t("driver.menu.driver_label", "Driver"),
    [t]
  );

  const [displayName, setDisplayName] = useState<string>(driverLabelFallback);

  // ✅ Photo: on stocke le PATH (storage) + buster
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUpdatedAt, setAvatarUpdatedAt] = useState<number>(0);

  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState<number>(0);

  // ✅ Total tips (semaine)
  const [tipsWeek, setTipsWeek] = useState<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((fn: () => void) => {
    if (mountedRef.current) fn();
  }, []);

  // ✅ si le nom est encore "placeholder", on le met à jour quand langue change
  useEffect(() => {
    safeSetState(() => {
      setDisplayName((prev) => {
        const p = String(prev || "").trim();
        if (!p || p === "Driver" || p === "Chauffeur") return driverLabelFallback;
        return prev;
      });
    });
  }, [driverLabelFallback, safeSetState]);

  const avatarUri = useMemo(() => {
    const nameFallback = makeAvatarUri(displayName);
    if (!avatarPath) return nameFallback;

    const pub = getPublicAvatarUrl(avatarPath);
    if (!pub) return nameFallback;

    const buster = avatarUpdatedAt || avatarPath;
    return withCacheBuster(pub, buster);
  }, [avatarPath, avatarUpdatedAt, displayName]);

  /**
   * ✅ NOTE DRIVER:
   * On essaye d'abord driver_rating_summary, sinon on calcule depuis driver_ratings.
   */
  const loadRating = useCallback(
    async (uid: string) => {
      try {
        const { data: sum, error: sumErr } = await supabase
          .from("driver_rating_summary")
          .select("driver_id, rating, rating_count")
          .eq("driver_id", uid)
          .maybeSingle();

        if (!sumErr && sum && Number((sum as any).rating_count) > 0) {
          const r = Number((sum as any).rating);
          const c = Number((sum as any).rating_count);

          safeSetState(() => {
            setAvgRating(Number.isFinite(r) ? r : null);
            setRatingCount(Number.isFinite(c) ? c : 0);
          });
          return;
        }

        const { data, error } = await supabase
          .from("driver_ratings")
          .select("rating")
          .eq("ratee_driver_id", uid)
          .order("created_at", { ascending: false })
          .limit(500);

        if (error) {
          console.log("driver_ratings error", error);
          safeSetState(() => {
            setAvgRating(null);
            setRatingCount(0);
          });
          return;
        }

        const ratings = (data ?? [])
          .map((r: any) => Number(r.rating))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

        if (!ratings.length) {
          safeSetState(() => {
            setAvgRating(null);
            setRatingCount(0);
          });
          return;
        }

        const sumRatings = ratings.reduce((a, b) => a + b, 0);

        safeSetState(() => {
          setAvgRating(sumRatings / ratings.length);
          setRatingCount(ratings.length);
        });
      } catch (e) {
        console.log("loadRating error", e);
        safeSetState(() => {
          setAvgRating(null);
          setRatingCount(0);
        });
      }
    },
    [safeSetState]
  );

  // ✅ READ total tips semaine depuis orders.tip_cents
  const loadTipsWeek = useCallback(
    async (uid: string) => {
      try {
        const now = new Date();
        const fromISO = startOfWeekMonday(now).toISOString();
        const toISO = endOfDay(now).toISOString();

        const { data, error } = await supabase
          .from("orders")
          .select("tip_cents, created_at")
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .limit(2000);

        if (error) {
          console.log("loadTipsWeek orders error", error);
          safeSetState(() => setTipsWeek(0));
          return;
        }

        const totalCents = (data ?? []).reduce((sum, o: any) => {
          const cents = Number(o?.tip_cents ?? 0);
          return sum + (Number.isFinite(cents) ? cents : 0);
        }, 0);

        safeSetState(() =>
          setTipsWeek(Math.floor((totalCents / 100) * 100) / 100)
        );
      } catch (e) {
        console.log("loadTipsWeek error", e);
        safeSetState(() => setTipsWeek(0));
      }
    },
    [safeSetState]
  );

  const loadHeader = useCallback(async () => {
    try {
      safeSetState(() => setLoading(true));

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) console.log("auth.getUser error", authErr);

      const user = authData?.user;
      if (!user) {
        safeSetState(() => {
          setDisplayName(driverLabelFallback);
          setAvatarPath(null);
          setAvatarUpdatedAt(0);
          setAvgRating(null);
          setRatingCount(0);
          setTipsWeek(0);
        });
        return;
      }

      const uid = user.id;

      const authFallback =
        (user.user_metadata as any)?.full_name ??
        (user.user_metadata as any)?.name ??
        user.email ??
        driverLabelFallback;

      // ✅ 1) Priorité: metadata auth
      const metaAvatarPath =
        ((user.user_metadata as any)?.avatar_path as string | undefined) ?? null;
      const metaUpdatedAt =
        Number((user.user_metadata as any)?.avatar_updated_at ?? 0) || 0;

      // ✅ 2) Nom: driver_profiles > profiles > auth
      const { data: dp, error: dpErr } = await supabase
        .from("driver_profiles")
        .select("user_id, full_name")
        .eq("user_id", uid)
        .maybeSingle();

      if (dpErr) console.log("driver_profiles error", dpErr);

      // ✅ 3) Fallback avatar depuis profiles.avatar_url (si jamais metadata vide)
      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", uid)
        .maybeSingle();

      if (pErr) console.log("profiles error", pErr);

      const dpName = (dp?.full_name ?? "").trim();
      const pName = (p?.full_name ?? "").trim();
      const finalName =
        dpName || pName || String(authFallback || driverLabelFallback);

      const profileAvatarPath =
        ((p as any)?.avatar_url as string | null) ?? null;
      const finalAvatarPath = metaAvatarPath || profileAvatarPath || null;

      safeSetState(() => {
        setDisplayName(finalName);
        setAvatarPath(finalAvatarPath);
        setAvatarUpdatedAt(metaUpdatedAt);
      });

      await Promise.all([loadRating(uid), loadTipsWeek(uid)]);
    } catch (e: any) {
      console.log("DriverMenu loadHeader error", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Error"),
        e?.message ?? t("driver.menu.load_error", "Unable to load driver menu.")
      );
    } finally {
      safeSetState(() => setLoading(false));
    }
  }, [driverLabelFallback, loadRating, loadTipsWeek, safeSetState, t]);

  useEffect(() => {
    loadHeader();
  }, [loadHeader]);

  useFocusEffect(
    useCallback(() => {
      loadHeader();
    }, [loadHeader])
  );

  const ratingLabel = useMemo(() => {
    if (!ratingCount) return t("driver.menu.new_driver", "New");
    if (avgRating == null || !Number.isFinite(avgRating)) return "—";
    return avgRating.toFixed(2);
  }, [avgRating, ratingCount, t]);

  const tipsWeekLabel = useMemo(() => {
    if (!Number.isFinite(tipsWeek) || tipsWeek <= 0) return "0.00 $";
    return fmtMoney(tipsWeek);
  }, [tipsWeek]);

  const onStripePress = useCallback(async () => {
    try {
      await startStripeOnboarding("driver");
    } catch (e: any) {
      console.log("startStripeOnboarding error", e);
      Alert.alert(
        t("driver.menu.payments_title", "Payments"),
        e?.message ??
          t("driver.menu.payments_unavailable", "Unable to open Stripe right now.")
      );
    }
  }, [t]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.menu.title", "Menu")}
        fallbackRoute="DriverTabs"
        showBack={navigation.canGoBack()}
        variant="dark"
        rightSlot={
          <TouchableOpacity
            onPress={() => navigation.navigate("DriverAccount")}
            style={styles.roundButton}
            activeOpacity={0.85}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate("DriverProfile")}
          disabled={loading}
          activeOpacity={0.88}
        >
          <View style={styles.avatarWrap}>
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
            <View style={styles.avatarGlow} />
          </View>

          <View style={styles.profileTextBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.nameText} numberOfLines={1}>
                {displayName}
              </Text>
              {loading ? <ActivityIndicator color={PURPLE} size="small" /> : null}
            </View>

            <View style={styles.ratingRow}>
              <StarsRow rating={avgRating} count={ratingCount} size={14} />
              <Text style={styles.ratingText}>
                {ratingLabel}
                {ratingCount > 0 ? ` (${ratingCount})` : ""}
              </Text>
            </View>

            <View style={styles.tipsPill}>
              <Text style={styles.tipsText}>
                {t("driver.menu.tips_week", "Tips this week")}: {tipsWeekLabel}
              </Text>
            </View>
          </View>

          <Text style={styles.profileArrow}>›</Text>
        </TouchableOpacity>

        <View style={styles.quickGrid}>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.quickCard}
            onPress={() => navigation.navigate("DriverServices")}
          >
            <View style={styles.quickIcon}>
              <MenuIcon name="spark" />
            </View>
            <Text style={styles.quickTitle}>Mes services</Text>
            <Text style={styles.quickSub}>Food, colis, taxi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.quickCard}
            onPress={() => navigation.navigate("DriverVehicles")}
          >
            <View style={styles.quickIcon}>
              <MenuIcon name="shield" />
            </View>
            <Text style={styles.quickTitle}>Mon véhicule</Text>
            <Text style={styles.quickSub}>Catégories taxi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.quickCard}
            onPress={() => navigation.navigate("DriverWallet")}
          >
            <View style={styles.quickIcon}>
              <MenuIcon name="wallet" />
            </View>
            <Text style={styles.quickTitle}>{t("driver.menu.wallet", "Wallet")}</Text>
            <Text style={styles.quickSub}>{t("driver.menu.wallet_sub", "Earnings & payouts")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.quickCard}
            onPress={() => navigation.navigate("DriverBenefits")}
          >
            <View style={styles.quickIcon}>
              <MenuIcon name="shield" />
            </View>
            <Text style={styles.quickTitle}>{t("driver.menu.driver_program", "Driver program")}</Text>
            <Text style={styles.quickSub}>{t("driver.menu.driver_program_sub", "Goals & rewards")}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{t("driver.menu.section_growth", "Growth")}</Text>

        <MenuItem
          icon="gift"
          label={t("driver.menu.referrals", "Referrals")}
          subtitle={t("driver.menu.referrals_sub", "Invite drivers and earn rewards")}
          onPress={() => navigation.navigate("DriverReferrals")}
        />

        <MenuItem
          icon="spark"
          label={t("driver.menu.opportunities", "Opportunities")}
          subtitle={t("driver.menu.opportunities_sub", "Promotions and new options")}
          badge
          onPress={() => navigation.navigate("DriverOpportunities")}
        />

        <Text style={styles.sectionTitle}>{t("driver.menu.section_account", "Account & payments")}</Text>

        <MenuItem
          icon="account"
          label={t("driver.menu.account", "Account")}
          subtitle={t("driver.menu.account_sub", "Profile, vehicle and documents")}
          onPress={() => navigation.navigate("DriverAccount")}
        />

        <MenuItem
          icon="card"
          label={t("driver.menu.payments_stripe", "Set up payments (Stripe)")}
          subtitle={t("driver.menu.payments_stripe_sub", "Connect your payout account")}
          onPress={onStripePress}
        />

        <Text style={styles.sectionTitle}>{t("driver.menu.section_support", "Support")}</Text>

        <MenuItem
          icon="help"
          label={t("driver.menu.help", "Help")}
          subtitle={t("driver.menu.help_sub", "Get support from MMD")}
          onPress={() => navigation.navigate("DriverHelp")}
        />

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuIcon({ name }: { name: MenuIconName }) {
  if (name === "wallet") {
    return (
      <View style={styles.walletIcon}>
        <View style={styles.walletBody} />
        <View style={styles.walletLine} />
      </View>
    );
  }

  if (name === "shield") {
    return (
      <View style={styles.shieldIcon}>
        <View style={styles.shieldShape} />
      </View>
    );
  }

  if (name === "gift") {
    return (
      <View style={styles.giftIcon}>
        <View style={styles.giftTop} />
        <View style={styles.giftBox} />
        <View style={styles.giftRibbon} />
      </View>
    );
  }

  if (name === "spark") {
    return <Text style={styles.iconGlyph}>✦</Text>;
  }

  if (name === "account" || name === "profile") {
    return (
      <View style={styles.profileIcon}>
        <View style={styles.profileHead} />
        <View style={styles.profileBody} />
      </View>
    );
  }

  if (name === "card") {
    return (
      <View style={styles.cardIcon}>
        <View style={styles.cardStripe} />
      </View>
    );
  }

  return <Text style={styles.iconGlyph}>?</Text>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 28,
  },
  headerRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  screenTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD_2,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: "#BFDBFE",
    fontSize: 34,
    fontWeight: "700",
    marginTop: -2,
  },
  settingsIcon: {
    color: PURPLE,
    fontSize: 19,
    fontWeight: "900",
  },
  profileCard: {
    marginTop: 18,
    marginBottom: 16,
    borderRadius: 28,
    padding: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.18)",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: PURPLE_DARK,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarGlow: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: "rgba(167,139,250,0.7)",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#111827",
  },
  profileTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nameText: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "900",
    flex: 1,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
    gap: 8,
  },
  ratingText: {
    color: MUTED,
    fontWeight: "900",
  },
  tipsPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
  },
  tipsText: {
    color: GREEN,
    fontWeight: "900",
    fontSize: 12,
  },
  profileArrow: {
    color: "#CBD5E1",
    fontSize: 28,
    fontWeight: "700",
    marginLeft: 8,
  },
  quickGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  quickCard: {
    flex: 1,
    minHeight: 118,
    borderRadius: 24,
    padding: 15,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "space-between",
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  quickTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 10,
  },
  quickSub: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  sectionTitle: {
    color: "#CBD5E1",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 14,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  menuItem: {
    minHeight: 72,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  menuIconBox: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuLabel: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },
  menuSub: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  menuRight: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 10,
  },
  dotBadge: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#60A5FA",
    marginRight: 10,
    shadowColor: "#60A5FA",
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  chevron: {
    color: "#CBD5E1",
    fontSize: 28,
    fontWeight: "600",
    marginTop: -2,
  },

  walletIcon: {
    width: 24,
    height: 20,
    justifyContent: "center",
  },
  walletBody: {
    position: "absolute",
    width: 23,
    height: 17,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  walletLine: {
    position: "absolute",
    right: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  shieldIcon: {
    width: 24,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldShape: {
    width: 20,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: PURPLE,
    transform: [{ rotate: "45deg" }],
  },
  giftIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  giftTop: {
    position: "absolute",
    top: 2,
    width: 22,
    height: 7,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  giftBox: {
    position: "absolute",
    bottom: 2,
    width: 20,
    height: 15,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  giftRibbon: {
    width: 2,
    height: 21,
    backgroundColor: PURPLE,
    borderRadius: 2,
  },
  profileIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
  },
  profileHead: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  profileBody: {
    marginTop: 3,
    width: 20,
    height: 10,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  cardIcon: {
    width: 24,
    height: 17,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  cardStripe: {
    position: "absolute",
    left: 3,
    right: 3,
    top: 4,
    height: 2,
    borderRadius: 2,
    backgroundColor: PURPLE,
  },
  iconGlyph: {
    color: PURPLE,
    fontSize: 22,
    fontWeight: "900",
  },
});
