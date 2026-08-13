import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../components/restaurant/RestaurantBrandLoadingState";
import { API_BASE_URL } from "../lib/apiBase";
import { supabase } from "../lib/supabase";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

type RestaurantTaxRange = "weekly" | "monthly" | "yearly";

type RestaurantTaxProfile = {
  restaurantName: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  isComplete: boolean;
  missingFields: string[];
};

type RestaurantTaxTotals = {
  grossSales: number;
  platformCommission: number;
  restaurantNet: number;
  totalOrders: number;
  year: number;
  range: RestaurantTaxRange;
  commissionRate?: number | null;
  month?: number | null;
  week?: number | null;
};

type RestaurantTaxFile = {
  bucket: string;
  path: string;
  signedUrl: string | null;
} | null;

type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
  range: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
  generatedAt: string;
  profile: RestaurantTaxProfile;
  totals: RestaurantTaxTotals;
  file: RestaurantTaxFile;
};

type RestaurantTaxScreenProps = {
  navigation: {
    goBack: () => void;
    navigate: (screen: string) => void;
  };
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(value) ? value : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeYear(value: number): number {
  const current = new Date().getFullYear();
  return clamp(Math.floor(value), 2020, current + 1);
}

function getApiUrl(apiBase: string | null, pathWithQuery: string) {
  const base = String(apiBase ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("API_BASE_URL manquant. Vérifie la configuration API production.");
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("API_BASE_URL doit être une URL absolue.");
  }
  return `${base}${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
}

function getInitialWeek(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;
  return clamp(Math.floor(diff / oneWeek) + 1, 1, 53);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const CARD_BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.7)";

/**
 * Figma Lot 5 — 348:7192 Loading / 348:7203 Error / 348:7216 Summary Complete.
 * Keeps /api/restaurant/tax/summary RPC (weekly|monthly|yearly).
 */
export default function RestaurantTaxScreen({
  navigation,
}: RestaurantTaxScreenProps) {
  const { t } = useTranslation();
  const now = new Date();

  const [range, setRange] = useState<RestaurantTaxRange>("monthly");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [week, setWeek] = useState<number>(getInitialWeek());

  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestaurantTaxSummary | null>(null);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);

  const apiBase = useMemo(() => {
    const value = String(API_BASE_URL ?? "").trim();
    return value ? value.replace(/\/+$/, "") : null;
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", range);
    params.set("year", String(year));
    if (range === "monthly") params.set("month", String(month));
    if (range === "weekly") params.set("week", String(week));
    return params.toString();
  }, [range, year, month, week]);

  const periodHeading = useMemo(() => {
    if (range === "monthly") {
      return `${MONTH_NAMES[clamp(month, 1, 12) - 1]} ${year}`;
    }
    if (range === "weekly") {
      const q = clamp(Math.ceil(week / 13), 1, 4);
      return t("restaurant.tax.quarterLabel", "Q{{q}} {{year}}", { q, year });
    }
    return String(year);
  }, [range, month, week, year, t]);

  useEffect(() => {
    let cancelled = false;

    async function resolveRestaurantAccess() {
      try {
        setAuthChecking(true);
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;

        if (!user?.id) {
          if (!cancelled) {
            setRestaurantUserId(null);
            setError(
              t(
                "restaurant.tax.errors.noSession",
                "Session introuvable. Reconnecte-toi puis réessaie."
              )
            );
          }
          return;
        }

        const { data: roleProfile, error: roleError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        if (roleError) {
          console.log("RestaurantTax role check error:", roleError);
        }

        const role = String((roleProfile as any)?.role || "")
          .trim()
          .toLowerCase();

        if (role && role !== "restaurant") {
          if (!cancelled) {
            setRestaurantUserId(null);
            setError(
              t(
                "restaurant.tax.errors.restaurantOnly",
                "Cette page est réservée aux comptes restaurant."
              )
            );
          }
          navigation.navigate(
            role === "driver"
              ? "DriverTabs"
              : role === "client"
                ? "ClientHome"
                : "RoleSelect"
          );
          return;
        }

        const { data: restaurantProfile, error: restaurantError } =
          await supabase
            .from("restaurant_profiles")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (restaurantError) {
          console.log("RestaurantTax profile check error:", restaurantError);
        }

        if (!restaurantProfile) {
          if (!cancelled) {
            setRestaurantUserId(null);
            setError(
              t(
                "restaurant.tax.errors.noRestaurantProfile",
                "Profil restaurant introuvable. Complète ton profil restaurant."
              )
            );
          }
          navigation.navigate("RestaurantSetup");
          return;
        }

        if (!cancelled) {
          setRestaurantUserId(user.id);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setRestaurantUserId(null);
          setError(
            e?.message ??
              t(
                "restaurant.tax.errors.unknown",
                "Une erreur inattendue est survenue."
              )
          );
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }

    void resolveRestaurantAccess();
    return () => {
      cancelled = true;
    };
  }, [navigation, t]);

  const fetchSummary = useCallback(
    async (download = false) => {
      try {
        if (download) setDownloading(true);
        else setLoading(true);
        setError(null);

        if (!restaurantUserId) {
          throw new Error(
            t(
              "restaurant.tax.errors.noRestaurantProfile",
              "Profil restaurant introuvable. Complète ton profil restaurant."
            )
          );
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) {
          throw new Error(
            t(
              "restaurant.tax.errors.noSession",
              "Session introuvable. Reconnecte-toi puis réessaie."
            )
          );
        }

        const url = getApiUrl(
          apiBase,
          `/api/restaurant/tax/summary?${queryString}${download ? "&download=1" : ""}`
        );

        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            json?.error ??
              t(
                "restaurant.tax.errors.fetchFailed",
                "Unable to load tax summary. Please try again."
              )
          );
        }

        const nextSummary = json as RestaurantTaxSummary;
        setSummary(nextSummary);

        if (download) {
          const signedUrl = nextSummary?.file?.signedUrl;
          if (!signedUrl) {
            throw new Error(
              t(
                "restaurant.tax.errors.noSignedUrl",
                "Le lien de téléchargement du PDF est introuvable."
              )
            );
          }
          const canOpen = await Linking.canOpenURL(signedUrl);
          if (!canOpen) {
            throw new Error(
              t(
                "restaurant.tax.errors.cannotOpenPdf",
                "Impossible d’ouvrir le lien du PDF."
              )
            );
          }
          await Linking.openURL(signedUrl);
        }
      } catch (e: any) {
        setError(
          e?.message ??
            t(
              "restaurant.tax.errors.unknown",
              "Une erreur inattendue est survenue."
            )
        );
      } finally {
        setLoading(false);
        setDownloading(false);
      }
    },
    [apiBase, queryString, restaurantUserId, t]
  );

  useEffect(() => {
    if (!authChecking && restaurantUserId) {
      void fetchSummary(false);
    }
  }, [authChecking, restaurantUserId, fetchSummary]);

  const profileComplete = summary?.profile?.isComplete ?? false;
  const canDownload =
    !!summary && !downloading && (summary?.profile?.isComplete ?? false);

  function selectRange(nextRange: RestaurantTaxRange) {
    setRange(nextRange);
    setSummary(null);
    setError(null);
  }

  const showLoading = authChecking || (loading && !summary && !error);

  if (showLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.tax.titleShort", "Taxes")}
          subtitle="🧾"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <RestaurantBrandLoadingState
          glass
          title={t("restaurant.tax.loadingTitle", "Loading Tax Data...")}
          subtitle={t(
            "restaurant.tax.loadingSubtitle",
            "Fetching your tax summary"
          )}
        />
      </SafeAreaView>
    );
  }

  if (error && !summary) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.tax.titleShort", "Taxes")}
          subtitle="🧾"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <View style={styles.centered}>
          <View style={styles.glassCard}>
            <View style={styles.iconCircle}>
              <Text style={styles.emoji}>❌</Text>
            </View>
            <Text style={styles.cardTitle}>
              {t("restaurant.tax.errorTitle", "Tax Error")}
            </Text>
            <Text style={styles.cardBody}>
              {error ||
                t(
                  "restaurant.tax.errorBody",
                  "Unable to load tax summary. Please try again."
                )}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => void fetchSummary(false)}
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>{t("common.retry", "Retry")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pillDefs: { key: RestaurantTaxRange; label: string }[] = [
    { key: "monthly", label: t("restaurant.tax.pill.month", "Month") },
    { key: "weekly", label: t("restaurant.tax.pill.quarter", "Quarter") },
    { key: "yearly", label: t("restaurant.tax.pill.year", "Year") },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={`${t("restaurant.tax.titleShort", "Taxes")} 🧾`}
        subtitle={t("restaurant.tax.summaryComplete", "Summary complete")}
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pills}>
          {pillDefs.map((pill) => {
            const active = range === pill.key;
            return (
              <TouchableOpacity
                key={pill.key}
                onPress={() => selectRange(pill.key)}
                style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.pillText,
                    active ? styles.pillTextActive : styles.pillTextIdle,
                  ]}
                >
                  {pill.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {range === "monthly" ? (
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => {
                if (month <= 1) {
                  setMonth(12);
                  setYear((y) => safeYear(y - 1));
                } else setMonth((m) => m - 1);
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.stepLabel}>{periodHeading}</Text>
            <TouchableOpacity
              onPress={() => {
                if (month >= 12) {
                  setMonth(1);
                  setYear((y) => safeYear(y + 1));
                } else setMonth((m) => m + 1);
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {range === "yearly" ? (
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => {
                setYear((y) => safeYear(y - 1));
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.stepLabel}>{year}</Text>
            <TouchableOpacity
              onPress={() => {
                setYear((y) => safeYear(y + 1));
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {range === "weekly" ? (
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => {
                setWeek((w) => clamp(w - 1, 1, 53));
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.stepLabel}>
              {t("restaurant.tax.weekLabel", "Week {{w}} · {{year}}", {
                w: week,
                year,
              })}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setWeek((w) => clamp(w + 1, 1, 53));
                setSummary(null);
              }}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {summary ? (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryPeriod}>{periodHeading}</Text>
              <Text style={styles.summaryLabel}>
                {t("restaurant.tax.taxableSales", "Taxable sales")}
              </Text>
              <Text style={styles.summaryAmount}>
                {money(summary.totals.grossSales)}
              </Text>
              <Text style={styles.summaryGreen}>
                {t("restaurant.tax.platformFeesLine", "Platform fees {{amount}}", {
                  amount: money(summary.totals.platformCommission),
                })}
              </Text>
            </View>

            <View style={styles.statusCard}>
              <View
                style={[
                  styles.statusIcon,
                  !profileComplete && styles.statusIconWarn,
                ]}
              >
                <Text style={styles.statusEmoji}>
                  {profileComplete ? "✅" : "⚠️"}
                </Text>
              </View>
              <View style={styles.statusText}>
                <Text
                  style={[
                    styles.statusTitle,
                    !profileComplete && { color: "#F59E0B" },
                  ]}
                >
                  {profileComplete
                    ? t("restaurant.tax.profileComplete", "Profile Complete")
                    : t("restaurant.tax.profileIncomplete", "Profile incomplete")}
                </Text>
                <Text style={styles.statusBody}>
                  {profileComplete
                    ? t(
                        "restaurant.tax.downloadReady",
                        "You can download the monthly PDF report."
                      )
                    : t(
                        "restaurant.tax.profileIncompleteNote",
                        "Complete your restaurant profile before generating official documents."
                      )}
                </Text>
                {!profileComplete ? (
                  <TouchableOpacity
                    onPress={() => navigation.navigate("RestaurantSetup")}
                    style={{ marginTop: 8 }}
                  >
                    <Text style={styles.link}>
                      {t("restaurant.tax.completeProfile", "Complete profile")}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.downloadBtn, !canDownload && { opacity: 0.65 }]}
              disabled={!canDownload}
              onPress={() => void fetchSummary(true)}
              accessibilityRole="button"
            >
              <Text style={styles.downloadLabel}>
                {downloading
                  ? t("restaurant.tax.downloading", "Downloading…")
                  : `📄 ${t("restaurant.tax.downloadPdf", "Download PDF")}`}
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  glassCard: {
    width: 320,
    maxWidth: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    gap: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 32, color: MMD_WHITE },
  cardTitle: {
    color: MMD_TEXT,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  cardBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 16,
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  pills: { flexDirection: "row", gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  pillActive: { backgroundColor: MMD_WHITE },
  pillIdle: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  pillText: { fontSize: 14 },
  pillTextActive: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  pillTextIdle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  stepLabel: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  summaryCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 24,
    padding: 24,
    gap: 12,
  },
  summaryPeriod: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  summaryLabel: {
    color: MUTED,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  summaryAmount: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  summaryGreen: {
    color: MMD_TAXI_GREEN,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  statusCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 24,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusIconWarn: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderColor: "rgba(245,158,11,0.3)",
  },
  statusEmoji: { fontSize: 20 },
  statusText: { flex: 1, gap: 4 },
  statusTitle: {
    color: MMD_TAXI_GREEN,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  statusBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  link: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  downloadBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
