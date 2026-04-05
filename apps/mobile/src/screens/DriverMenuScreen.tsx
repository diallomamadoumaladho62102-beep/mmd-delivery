// apps/mobile/src/screens/DriverMenuScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";

type MenuItemProps = {
  label: string;
  onPress?: () => void;
  badge?: boolean;
};

function MenuItem({ label, onPress, badge }: MenuItemProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      activeOpacity={0.8}
    >
      <Text style={{ color: "white", fontSize: 18, fontWeight: "600" }}>
        {label}
      </Text>

      {badge ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: "#3B82F6",
          }}
        />
      ) : null}
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontWeight: "700" }}>
            ← {t("common.back", "Back")}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 24,
            marginBottom: 32,
          }}
          onPress={() => navigation.navigate("DriverProfile")}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Image
            source={{ uri: avatarUri }}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              marginRight: 16,
              backgroundColor: "#111827",
            }}
          />

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ color: "white", fontSize: 20, fontWeight: "800" }}>
                {displayName}
              </Text>

              {loading ? <ActivityIndicator color="#93C5FD" /> : null}
            </View>

            <View
              style={{
                marginTop: 6,
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StarsRow rating={avgRating} count={ratingCount} size={14} />
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {ratingLabel}
                  {ratingCount > 0 ? ` (${ratingCount})` : ""}
                </Text>
              </View>

              {/* ✅ Tips semaine */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: "#64748B", fontWeight: "900" }}>•</Text>
                <Text style={{ color: "#22C55E", fontWeight: "900" }}>
                  {t("driver.menu.tips_week", "Tips this week")}: {tipsWeekLabel}
                </Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        <MenuItem
          label={t("driver.menu.referrals", "Referrals")}
          onPress={() => navigation.navigate("DriverReferrals")}
        />

        <MenuItem
          label={t("driver.menu.opportunities", "Opportunities")}
          badge
          onPress={() => navigation.navigate("DriverOpportunities")}
        />

        <MenuItem
          label={t("driver.menu.driver_program", "Driver program")}
          onPress={() => navigation.navigate("DriverBenefits")}
        />

        <MenuItem
          label={t("driver.menu.wallet", "Wallet")}
          onPress={() => navigation.navigate("DriverWallet")}
        />

        <MenuItem
          label={t("driver.menu.account", "Account")}
          onPress={() => navigation.navigate("DriverAccount")}
        />

        <MenuItem
          label={t("driver.menu.payments_stripe", "Set up payments (Stripe)")}
          onPress={onStripePress}
        />

        <View
          style={{
            height: 1,
            backgroundColor: "#1F2933",
            marginVertical: 24,
          }}
        />

        <MenuItem
          label={t("driver.menu.help", "Help")}
          onPress={() => navigation.navigate("DriverHelp")}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
