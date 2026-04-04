import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

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
};

type RestaurantTaxFile = {
  bucket: string;
  path: string;
  signedUrl: string | null;
} | null;

type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
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

export default function RestaurantTaxScreen({
  navigation,
}: RestaurantTaxScreenProps) {
  const { t } = useTranslation();

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestaurantTaxSummary | null>(null);

  const apiBase = useMemo(() => {
    const value = process.env.EXPO_PUBLIC_API_BASE_URL;

    if (!value) return null;

    return value.replace(/\/+$/, "");
  }, []);

  const fetchSummary = useCallback(
    async (download = false) => {
      try {
        if (download) {
          setDownloading(true);
        } else {
          setLoading(true);
        }

        setError(null);

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.access_token) {
          throw new Error(
            t(
              "restaurant.tax.errors.noSession",
              "Session introuvable. Reconnecte-toi puis réessaie."
            )
          );
        }

        if (!apiBase) {
          throw new Error(
            "EXPO_PUBLIC_API_BASE_URL manquant dans les variables d’environnement."
          );
        }

        const response = await fetch(
          `${apiBase}/api/restaurant/tax/summary?year=${year}${
            download ? "&download=1" : ""
          }`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

        const json = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            json?.error ??
              t(
                "restaurant.tax.errors.fetchFailed",
                "Impossible de charger les données fiscales restaurant."
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
    [apiBase, t, year]
  );

  useEffect(() => {
    void fetchSummary(false);
  }, [fetchSummary]);

  const profileComplete = summary?.profile?.isComplete ?? false;
  const missingFields = summary?.profile?.missingFields ?? [];

  const missingFieldsLabel = useMemo(() => {
    if (!missingFields.length) return "—";
    return missingFields.join(", ");
  }, [missingFields]);

  const canDownload = !!summary && !downloading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
            }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 16 }}>
              ←
            </Text>
          </TouchableOpacity>

          <View style={{ flex: 1, paddingHorizontal: 10 }}>
            <Text
              style={{
                color: "white",
                fontSize: 20,
                fontWeight: "900",
                textAlign: "center",
              }}
            >
              {t("restaurant.tax.title", "Restaurant Tax Center")}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                textAlign: "center",
                marginTop: 4,
              }}
            >
              {t(
                "restaurant.tax.subtitle",
                "Manage your restaurant tax information, yearly earnings, and downloadable tax documents."
              )}
            </Text>
          </View>

          <View style={{ width: 28 }} />
        </View>

        <View
          style={{
            backgroundColor: "#020617",
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: "#1F2937",
            marginBottom: 14,
          }}
        >
          <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
            {t("restaurant.tax.reportingYear", "Reporting year")}
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 12,
            }}
          >
            <TouchableOpacity
              onPress={() => setYear((prev) => prev - 1)}
              style={{
                backgroundColor: "rgba(15,23,42,0.8)",
                borderWidth: 1,
                borderColor: "#1F2937",
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>-1</Text>
            </TouchableOpacity>

            <Text
              style={{
                color: "white",
                fontWeight: "900",
                fontSize: 22,
              }}
            >
              {year}
            </Text>

            <TouchableOpacity
              onPress={() => setYear((prev) => prev + 1)}
              style={{
                backgroundColor: "rgba(15,23,42,0.8)",
                borderWidth: 1,
                borderColor: "#1F2937",
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>+1</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              onPress={() => void fetchSummary(false)}
              disabled={loading}
              style={{
                flex: 1,
                backgroundColor: "#2563EB",
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                opacity: loading ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {loading
                  ? t("common.loading", "Chargement…")
                  : t("common.refresh", "Refresh")}
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
                  : t("restaurant.tax.downloadPdf", "Download tax PDF")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 18,
              padding: 22,
              borderWidth: 1,
              borderColor: "#1F2937",
              alignItems: "center",
            }}
          >
            <ActivityIndicator />
            <Text style={{ color: "#94A3B8", marginTop: 10 }}>
              {t("common.loading", "Chargement…")}
            </Text>
          </View>
        ) : error ? (
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 18,
              padding: 18,
              borderWidth: 1,
              borderColor: "#7F1D1D",
            }}
          >
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{error}</Text>
          </View>
        ) : !summary ? (
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 18,
              padding: 18,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
              {t("restaurant.tax.noData", "No data available.")}
            </Text>
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: "#020617",
                borderRadius: 18,
                padding: 16,
                borderWidth: 1,
                borderColor: "#1F2937",
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.earningsTitle", "Restaurant earnings summary")}
              </Text>

              <View style={{ marginTop: 14, gap: 12 }}>
                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.grossSales", "Gross sales")}
                  </Text>
                  <Text
                    style={{
                      color: "white",
                      fontSize: 22,
                      fontWeight: "900",
                      marginTop: 4,
                    }}
                  >
                    {money(summary.totals.grossSales)}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.platformCommission", "Platform commission")}
                  </Text>
                  <Text
                    style={{
                      color: "#FCA5A5",
                      fontSize: 20,
                      fontWeight: "900",
                      marginTop: 4,
                    }}
                  >
                    {money(summary.totals.platformCommission)}
                  </Text>
                  <Text style={{ color: "#64748B", marginTop: 3 }}>
                    {t(
                      "restaurant.tax.platformCommissionNote",
                      "15% MMD Delivery commission"
                    )}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.restaurantNet", "Restaurant net")}
                  </Text>
                  <Text
                    style={{
                      color: "#22C55E",
                      fontSize: 22,
                      fontWeight: "900",
                      marginTop: 4,
                    }}
                  >
                    {money(summary.totals.restaurantNet)}
                  </Text>
                </View>

                <View>
                  <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                    {t("restaurant.tax.totalOrders", "Total orders")}
                  </Text>
                  <Text
                    style={{
                      color: "white",
                      fontSize: 20,
                      fontWeight: "900",
                      marginTop: 4,
                    }}
                  >
                    {summary.totals.totalOrders}
                  </Text>
                </View>
              </View>
            </View>

            <View
              style={{
                backgroundColor: "#020617",
                borderRadius: 18,
                padding: 16,
                borderWidth: 1,
                borderColor: profileComplete ? "#14532D" : "#7C2D12",
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.profileTitle", "Tax profile")}
              </Text>

              <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                {t(
                  "restaurant.tax.profileSubtitle",
                  "Restaurant tax identity and reporting information."
                )}
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
                  {[
                    summary.profile.address,
                    summary.profile.city,
                    summary.profile.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </Text>
              </View>

              <View
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: profileComplete
                    ? "rgba(34,197,94,0.12)"
                    : "rgba(245,158,11,0.12)",
                  borderWidth: 1,
                  borderColor: profileComplete ? "#14532D" : "#92400E",
                }}
              >
                <Text
                  style={{
                    color: profileComplete ? "#BBF7D0" : "#FDE68A",
                    fontWeight: "900",
                  }}
                >
                  {profileComplete
                    ? t("restaurant.tax.profileComplete", "Profile complete")
                    : t("restaurant.tax.profileIncomplete", "Profile incomplete")}
                </Text>

                {!profileComplete && (
                  <>
                    <Text style={{ color: "#FDE68A", marginTop: 8 }}>
                      {t(
                        "restaurant.tax.profileIncompleteNote",
                        "Complete your restaurant profile before generating official yearly tax documents."
                      )}
                    </Text>

                    <Text
                      style={{
                        color: "#FDE68A",
                        marginTop: 8,
                        fontWeight: "800",
                      }}
                    >
                      {t("restaurant.tax.missingFields", "Missing fields")}:{" "}
                      {missingFieldsLabel}
                    </Text>

                    <TouchableOpacity
                      onPress={() => navigation.navigate("RestaurantMenu")}
                      style={{
                        marginTop: 12,
                        alignSelf: "flex-start",
                        backgroundColor: "rgba(15,23,42,0.75)",
                        borderWidth: 1,
                        borderColor: "#1F2937",
                        borderRadius: 12,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                      }}
                    >
                      <Text style={{ color: "white", fontWeight: "900" }}>
                        {t("restaurant.tax.completeProfile", "Complete profile")}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            <View
              style={{
                backgroundColor: "#020617",
                borderRadius: 18,
                padding: 16,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
                {t("restaurant.tax.yearlyDocuments", "Yearly tax documents")}
              </Text>

              <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                {t(
                  "restaurant.tax.yearlyDocumentsNote",
                  "Download your restaurant tax summary PDF for the selected year."
                )}
              </Text>

              <View
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: "rgba(15,23,42,0.7)",
                  borderWidth: 1,
                  borderColor: "#1F2937",
                }}
              >
                <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 16 }}>
                  {t("restaurant.tax.summaryForYear", "Tax summary for {{year}}", {
                    year: summary.year,
                  })}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 10 }}>
                  {t("restaurant.tax.grossSales", "Gross sales")}:{" "}
                  {money(summary.totals.grossSales)}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                  {t("restaurant.tax.platformCommissionShort", "Commission")}:{" "}
                  {money(summary.totals.platformCommission)}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                  {t("restaurant.tax.restaurantNet", "Restaurant net")}:{" "}
                  {money(summary.totals.restaurantNet)}
                </Text>

                <TouchableOpacity
                  onPress={() => void fetchSummary(true)}
                  disabled={!canDownload}
                  style={{
                    marginTop: 14,
                    backgroundColor: "#2563EB",
                    borderRadius: 12,
                    paddingVertical: 13,
                    alignItems: "center",
                    opacity: canDownload ? 1 : 0.7,
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {downloading
                      ? t("restaurant.tax.downloading", "Downloading…")
                      : t("restaurant.tax.downloadYearPdf", "Download {{year}} PDF", {
                          year: summary.year,
                        })}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={{ color: "#64748B", marginTop: 12 }}>
                {t(
                  "restaurant.tax.commissionModelNote",
                  "Connected to your 15% restaurant commission model"
                )}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}