import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { API_BASE_URL } from "../lib/apiBase";
import { supabase } from "../lib/supabase";

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

function formatCommissionRate(rate?: number | null): string {
  const safeRate = Number(rate ?? 0);

  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    return "Platform commission";
  }

  const percent = Math.round(safeRate * 100);
  return `Platform commission (${percent}%)`;
}

function periodLabel(params: {
  range: RestaurantTaxRange;
  year: number;
  month: number;
  week: number;
}) {
  const { range, year, month, week } = params;

  if (range === "weekly") return `Week ${week} • ${year}`;
  if (range === "monthly") return `Month ${month} • ${year}`;
  return `Year ${year}`;
}

function getRangeLabel(range: RestaurantTaxRange) {
  if (range === "weekly") return "Weekly";
  if (range === "monthly") return "Monthly";
  return "Yearly";
}

export default function RestaurantTaxScreen({
  navigation,
}: RestaurantTaxScreenProps) {
  const { t } = useTranslation();

  const now = new Date();

  const [range, setRange] = useState<RestaurantTaxRange>("yearly");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [week, setWeek] = useState<number>(getInitialWeek());

  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestaurantTaxSummary | null>(null);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);

  const apiBase = useMemo(() => {
    const value = String(API_BASE_URL ?? "").trim();
    return value ? value.replace(/\/+$/, "") : null;
  }, []);

  const selectedPeriodLabel = useMemo(
    () => periodLabel({ range, year, month, week }),
    [range, year, month, week],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    params.set("range", range);
    params.set("year", String(year));

    if (range === "monthly") params.set("month", String(month));
    if (range === "weekly") params.set("week", String(week));

    return params.toString();
  }, [range, year, month, week]);


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

          navigation.navigate(role === "driver" ? "DriverTabs" : role === "client" ? "ClientHome" : "RoleSelect");
          return;
        }

        const { data: restaurantProfile, error: restaurantError } = await supabase
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
        if (!cancelled) {
          setAuthChecking(false);
        }
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
        if (download) {
          setDownloading(true);
        } else {
          setLoading(true);
        }

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
              "Session introuvable. Reconnecte-toi puis réessaie.",
            ),
          );
        }

        const url = getApiUrl(
          apiBase,
          `/api/restaurant/tax/summary?${queryString}${download ? "&download=1" : ""}`
        );

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const json = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            json?.error ??
              t(
                "restaurant.tax.errors.fetchFailed",
                "Impossible de charger les données fiscales restaurant.",
              ),
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
                "Le lien de téléchargement du PDF est introuvable.",
              ),
            );
          }

          const canOpen = await Linking.canOpenURL(signedUrl);

          if (!canOpen) {
            throw new Error(
              t(
                "restaurant.tax.errors.cannotOpenPdf",
                "Impossible d’ouvrir le lien du PDF.",
              ),
            );
          }

          await Linking.openURL(signedUrl);
        }
      } catch (e: any) {
        setError(
          e?.message ??
            t(
              "restaurant.tax.errors.unknown",
              "Une erreur inattendue est survenue.",
            ),
        );
      } finally {
        setLoading(false);
        setDownloading(false);
      }
    },
    [apiBase, queryString, restaurantUserId, t],
  );

  useEffect(() => {
    if (!authChecking && restaurantUserId) {
      void fetchSummary(false);
    }
  }, [authChecking, restaurantUserId, fetchSummary]);

  const profileComplete = summary?.profile?.isComplete ?? false;
  const missingFields = summary?.profile?.missingFields ?? [];

  const missingFieldsLabel = useMemo(() => {
    if (!missingFields.length) return "—";
    return missingFields.join(", ");
  }, [missingFields]);

  const canDownload = !!summary && !downloading && (summary?.profile?.isComplete ?? false);

  function selectRange(nextRange: RestaurantTaxRange) {
    setRange(nextRange);
    setSummary(null);
    setError(null);
  }

  function changeYear(delta: number) {
    setYear((prev) => safeYear(prev + delta));
    setSummary(null);
    setError(null);
  }

  function changeMonth(delta: number) {
    setMonth((prev) => clamp(prev + delta, 1, 12));
    setSummary(null);
    setError(null);
  }

  function changeWeek(delta: number) {
    setWeek((prev) => clamp(prev + delta, 1, 53));
    setSummary(null);
    setError(null);
  }

  const commissionText = formatCommissionRate(summary?.totals?.commissionRate);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <ScreenHeader
          title={t("restaurant.tax.title", "Restaurant Tax Center")}
          subtitle={t(
            "restaurant.tax.subtitle",
            "Review weekly, monthly and yearly restaurant earnings, commissions and tax documents.",
          )}
          fallbackRoute="RestaurantCommandCenter"
          variant="dark"
          style={{ paddingHorizontal: 0, paddingTop: 0 }}
        />

        <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#1F2937", marginBottom: 14 }}>
          <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
            {t("restaurant.tax.reportingPeriod", "Reporting period")}
          </Text>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {(["weekly", "monthly", "yearly"] as RestaurantTaxRange[]).map((item) => {
              const active = range === item;

              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => selectRange(item)}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 10,
                    alignItems: "center",
                    backgroundColor: active ? "#2563EB" : "#111827",
                    borderWidth: 1,
                    borderColor: active ? "#60A5FA" : "#1F2937",
                  }}
                >
                  <Text style={{ color: active ? "white" : "#94A3B8", fontWeight: "900" }}>
                    {getRangeLabel(item)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={{ color: "#94A3B8", fontWeight: "800", marginTop: 16 }}>
            {selectedPeriodLabel}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <TouchableOpacity onPress={() => changeYear(-1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
              <Text style={{ color: "white", fontWeight: "900" }}>-1 year</Text>
            </TouchableOpacity>

            <Text style={{ color: "white", fontWeight: "900", fontSize: 22 }}>{year}</Text>

            <TouchableOpacity onPress={() => changeYear(1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
              <Text style={{ color: "white", fontWeight: "900" }}>+1 year</Text>
            </TouchableOpacity>
          </View>

          {range === "monthly" ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: "white", fontWeight: "900" }}>-1 month</Text>
              </TouchableOpacity>

              <Text style={{ color: "white", fontWeight: "900", fontSize: 20 }}>Month {month}</Text>

              <TouchableOpacity onPress={() => changeMonth(1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: "white", fontWeight: "900" }}>+1 month</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {range === "weekly" ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <TouchableOpacity onPress={() => changeWeek(-1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: "white", fontWeight: "900" }}>-1 week</Text>
              </TouchableOpacity>

              <Text style={{ color: "white", fontWeight: "900", fontSize: 20 }}>Week {week}</Text>

              <TouchableOpacity onPress={() => changeWeek(1)} style={{ backgroundColor: "rgba(15,23,42,0.8)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Text style={{ color: "white", fontWeight: "900" }}>+1 week</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              onPress={() => void fetchSummary(false)}
              disabled={authChecking || loading}
              style={{
                flex: 1,
                backgroundColor: "#2563EB",
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                opacity: authChecking || loading ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {loading ? t("common.loading", "Chargement…") : t("common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!canDownload}
              onPress={() => void fetchSummary(true)}
              style={{
                flex: 1,
                backgroundColor: summary ? "rgba(37,99,235,0.14)" : "#111827",
                borderWidth: 1,
                borderColor: "#1D4ED8",
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                opacity: canDownload ? 1 : 0.7,
              }}
            >
              <Text style={{ color: "#DBEAFE", fontWeight: "900" }}>
                {downloading
                  ? t("restaurant.tax.downloading", "Downloading…")
                  : t("restaurant.tax.downloadPdf", "Download PDF")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {authChecking || loading ? (
          <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 22, borderWidth: 1, borderColor: "#1F2937", alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "#94A3B8", marginTop: 10 }}>
              {t("common.loading", "Chargement…")}
            </Text>
          </View>
        ) : error ? (
          <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#7F1D1D" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{error}</Text>
          </View>
        ) : !summary ? (
          <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#1F2937" }}>
            <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
              {t("restaurant.tax.noData", "No data available.")}
            </Text>
          </View>
        ) : (
          <>
            <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#1F2937", marginBottom: 14 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.earningsTitle", "Restaurant earnings summary")}
              </Text>

              <Text style={{ color: "#64748B", marginTop: 4 }}>{selectedPeriodLabel}</Text>

              <View style={{ marginTop: 14, gap: 12 }}>
                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.grossSales", "Gross sales")}
                  </Text>
                  <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 4 }}>
                    {money(summary.totals.grossSales)}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>{commissionText}</Text>
                  <Text style={{ color: "#FCA5A5", fontSize: 20, fontWeight: "900", marginTop: 4 }}>
                    {money(summary.totals.platformCommission)}
                  </Text>
                  <Text style={{ color: "#64748B", marginTop: 3 }}>
                    {t("restaurant.tax.platformCommissionNote", "Commission configured from Admin Pricing")}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.restaurantNet", "Restaurant net")}
                  </Text>
                  <Text style={{ color: "#22C55E", fontSize: 22, fontWeight: "900", marginTop: 4 }}>
                    {money(summary.totals.restaurantNet)}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.totalOrders", "Total orders")}
                  </Text>
                  <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 4 }}>
                    {summary.totals.totalOrders}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: profileComplete ? "#14532D" : "#7C2D12", marginBottom: 14 }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.profileTitle", "Tax profile")}
              </Text>

              <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                {t("restaurant.tax.profileSubtitle", "Restaurant tax identity and reporting information.")}
              </Text>

              <View style={{ marginTop: 14, gap: 10 }}>
                <Text style={{ color: "#E5E7EB" }}>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.restaurantName", "Restaurant name")}:
                  </Text>{" "}
                  {summary.profile.restaurantName ?? "—"}
                </Text>

                <Text style={{ color: "#E5E7EB" }}>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.email", "Email")}:
                  </Text>{" "}
                  {summary.profile.email ?? "—"}
                </Text>

                <Text style={{ color: "#E5E7EB" }}>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.taxId", "Tax ID / EIN")}:
                  </Text>{" "}
                  {summary.profile.taxId ?? "—"}
                </Text>

                <Text style={{ color: "#E5E7EB" }}>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.phone", "Phone")}:
                  </Text>{" "}
                  {summary.profile.phone ?? "—"}
                </Text>

                <Text style={{ color: "#E5E7EB" }}>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.address", "Business address")}:
                  </Text>{" "}
                  {[summary.profile.address, summary.profile.city, summary.profile.postalCode]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </Text>
              </View>

              <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: profileComplete ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: profileComplete ? "#14532D" : "#92400E" }}>
                <Text style={{ color: profileComplete ? "#BBF7D0" : "#FDE68A", fontWeight: "900" }}>
                  {profileComplete
                    ? t("restaurant.tax.profileComplete", "Profile complete")
                    : t("restaurant.tax.profileIncomplete", "Profile incomplete")}
                </Text>

                {!profileComplete ? (
                  <>
                    <Text style={{ color: "#FDE68A", marginTop: 8 }}>
                      {t("restaurant.tax.profileIncompleteNote", "Complete your restaurant profile before generating official documents.")}
                    </Text>

                    <Text style={{ color: "#FDE68A", marginTop: 8, fontWeight: "800" }}>
                      {t("restaurant.tax.missingFields", "Missing fields")}: {missingFieldsLabel}
                    </Text>

                    <TouchableOpacity
                      onPress={() => navigation.navigate("RestaurantSetup")}
                      style={{ marginTop: 12, alignSelf: "flex-start", backgroundColor: "rgba(15,23,42,0.75)", borderWidth: 1, borderColor: "#1F2937", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 }}
                    >
                      <Text style={{ color: "white", fontWeight: "900" }}>
                        {t("restaurant.tax.completeProfile", "Complete profile")}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            </View>

            <View style={{ backgroundColor: "#020617", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#1F2937" }}>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.documents", "Tax documents")}
              </Text>

              <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                {t("restaurant.tax.documentsNote", "Download your restaurant summary PDF for the selected period.")}
              </Text>

              <View style={{ marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: "rgba(15,23,42,0.7)", borderWidth: 1, borderColor: "#1F2937" }}>
                <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 16 }}>
                  Summary for {selectedPeriodLabel}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 10 }}>
                  {t("restaurant.tax.grossSales", "Gross sales")}: {money(summary.totals.grossSales)}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                  {t("restaurant.tax.platformCommissionShort", "Commission")}: {money(summary.totals.platformCommission)}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                  {t("restaurant.tax.restaurantNet", "Restaurant net")}: {money(summary.totals.restaurantNet)}
                </Text>

                <TouchableOpacity
                  onPress={() => void fetchSummary(true)}
                  disabled={!canDownload}
                  style={{ marginTop: 14, backgroundColor: "#2563EB", borderRadius: 12, paddingVertical: 13, alignItems: "center", opacity: canDownload ? 1 : 0.7 }}
                >
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {downloading
                      ? t("restaurant.tax.downloading", "Downloading…")
                      : t("restaurant.tax.downloadPdf", "Download PDF")}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={{ color: "#64748B", marginTop: 12 }}>
                {t("restaurant.tax.commissionModelNote", "Connected to your Admin Pricing restaurant commission model")}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}