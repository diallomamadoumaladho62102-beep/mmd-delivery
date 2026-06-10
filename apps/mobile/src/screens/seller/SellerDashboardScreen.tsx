import React, { useCallback, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  loadOwnSeller,
  loadSellerDashboardCounts,
  requireSellerPlatformEnabled,
} from "../../lib/sellerApi";
import { sellerStatusLabel, type SellerRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

function statusMessage(status: string, t: (k: string, f: string) => string): string {
  if (status === "approved") {
    return t(
      "seller.dashboard.approved",
      "Your seller account is approved. You can manage products."
    );
  }
  if (status === "rejected") {
    return t(
      "seller.dashboard.rejected",
      "Your seller application was rejected. Contact support for details."
    );
  }
  if (status === "suspended") {
    return t(
      "seller.dashboard.suspended",
      "Your seller account is suspended. New marketplace activity is blocked."
    );
  }
  return t(
    "seller.dashboard.pending",
    "Your seller application is pending admin review."
  );
}

export default function SellerDashboardScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [platformOk, setPlatformOk] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const enabled = await requireSellerPlatformEnabled();
      setPlatformOk(enabled);
      const row = await loadOwnSeller();
      setSeller(row);
      if (row) {
        const counts = await loadSellerDashboardCounts(row.id);
        setProductCount(counts.productCount);
        setOrderCount(counts.orderCount);
      }
    } catch (e) {
      console.log("SellerDashboard refresh error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const canManageProducts = platformOk && seller?.status === "approved";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text style={{ color: "#F8FAFC", fontSize: 24, fontWeight: "800" }}>
          {t("seller.dashboard.title", "Seller Dashboard")}
        </Text>

        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : (
          <>
            <View
              style={{
                backgroundColor: "#111827",
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#CBD5E1", marginBottom: 4 }}>
                {seller?.business_name ?? "—"}
              </Text>
              <Text style={{ color: "#94A3B8", marginBottom: 8 }}>
                {sellerStatusLabel(seller?.status ?? "pending")}
              </Text>
              <Text style={{ color: "#E2E8F0" }}>
                {statusMessage(seller?.status ?? "pending", t)}
              </Text>
              {!platformOk ? (
                <Text style={{ color: "#FCA5A5", marginTop: 8 }}>
                  {t(
                    "seller.dashboard.platformOff",
                    "Seller services are disabled in your region."
                  )}
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <StatCard label={t("seller.stats.products", "Products")} value={productCount} />
              <StatCard label={t("seller.stats.orders", "Orders")} value={orderCount} />
            </View>

            <TouchableOpacity
              disabled={!canManageProducts}
              onPress={() => navigation.navigate("SellerProducts")}
              style={buttonStyle(!canManageProducts)}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {t("seller.actions.products", "Manage products")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("SellerOrders")}
              style={buttonStyle(false, true)}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {t("seller.actions.orders", "View orders")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#111827",
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: "#1F2937",
      }}
    >
      <Text style={{ color: "#94A3B8", fontSize: 12 }}>{label}</Text>
      <Text style={{ color: "#F8FAFC", fontSize: 24, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

function buttonStyle(disabled: boolean, secondary = false) {
  return {
    backgroundColor: secondary ? "#334155" : disabled ? "#4C1D95" : "#7C3AED",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center" as const,
    opacity: disabled ? 0.5 : 1,
  };
}
