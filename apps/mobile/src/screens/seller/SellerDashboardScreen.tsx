import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { UiLoadingState } from "../../components/ui/UiStates";
import {
  loadOwnSeller,
  loadSellerDashboardCounts,
  requireSellerPlatformEnabled,
  setSellerAcceptingOrders,
} from "../../lib/sellerApi";
import { sellerStatusLabel, type SellerRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";
import { APP_COLORS } from "../../theme/appTheme";
import { startStripeOnboarding } from "../../utils/stripe";
import { supabase } from "../../lib/supabase";
import {
  normalizeStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
  type StripeConnectStatusCode,
} from "../../lib/stripeConnectStatus";
import { toUserFacingError } from "../../lib/userFacingError";

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
  const [togglingShop, setTogglingShop] = useState(false);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatusCode>("setup_required");
  const [stripeLabel, setStripeLabel] = useState(stripeConnectStatusLabel("setup_required"));
  const [stripeMessage, setStripeMessage] = useState(
    stripeConnectUserMessage("setup_required"),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const gate = await requireSellerPlatformEnabled();
      setPlatformOk(gate.enabled);
      const row = await loadOwnSeller();
      setSeller(row);
      if (row) {
        const counts = await loadSellerDashboardCounts(row.id);
        setProductCount(counts.productCount);
        setOrderCount(counts.orderCount);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          const { data: connectData } = await supabase.functions.invoke(
            "check_connect_status",
            {
              body: { role: "seller" },
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (connectData && typeof connectData === "object") {
            const connect = connectData as Record<string, unknown>;
            const code = normalizeStripeConnectStatus(connect.status);
            setStripeStatus(code);
            setStripeLabel(
              String(connect.status_label ?? "") || stripeConnectStatusLabel(code),
            );
            setStripeMessage(stripeConnectUserMessage(code));
          } else {
            const code = normalizeStripeConnectStatus(
              row.stripe_onboarding_status ??
                (row.stripe_payouts_enabled ? "ready_for_payouts" : "setup_required"),
            );
            setStripeStatus(code);
            setStripeLabel(stripeConnectStatusLabel(code));
            setStripeMessage(stripeConnectUserMessage(code));
          }
        }
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
  const canToggleShop = platformOk && seller?.status === "approved";

  const onToggleShopOpen = async (nextValue: boolean) => {
    if (!seller || !canToggleShop) return;
    try {
      setTogglingShop(true);
      const updated = await setSellerAcceptingOrders(seller.id, nextValue);
      setSeller(updated);
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("seller.dashboard.toggleFailed", "Unable to update shop status.")
      );
    } finally {
      setTogglingShop(false);
    }
  };

  const onOpenStripe = async () => {
    if (stripeBusy) return;
    try {
      setStripeBusy(true);
      await startStripeOnboarding("seller");
      await refresh();
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(
          e,
          t("seller.dashboard.stripeError", "Unable to open Stripe Connect."),
        ),
      );
    } finally {
      setStripeBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_COLORS.bg }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.dashboard.title", "Seller Dashboard")}
        fallbackRoute="SellerDashboard"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 16 }}>

        {loading ? (
          <UiLoadingState />
        ) : (
          <>
            <View
              style={{
                backgroundColor: APP_COLORS.surface,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: APP_COLORS.border,
              }}
            >
              <Text style={{ color: APP_COLORS.textSubtle, marginBottom: 4 }}>
                {seller?.business_name ?? "—"}
              </Text>
              <Text style={{ color: APP_COLORS.textMuted, marginBottom: 8 }}>
                {sellerStatusLabel(seller?.status ?? "pending")}
              </Text>
              <Text style={{ color: "#E2E8F0" }}>
                {statusMessage(seller?.status ?? "pending", t)}
              </Text>
              {!platformOk ? (
                <Text style={{ color: APP_COLORS.danger, marginTop: 8 }}>
                  {t(
                    "seller.dashboard.platformOff",
                    "Seller services are disabled in your region."
                  )}
                </Text>
              ) : null}
            </View>

            {seller && canManageProducts ? (
              <View
                style={{
                  backgroundColor: APP_COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: APP_COLORS.border,
                  gap: 10,
                }}
              >
                <Text style={{ color: APP_COLORS.text, fontWeight: "800", fontSize: 16 }}>
                  {t("seller.dashboard.payoutsTitle", "Payouts (Stripe Connect)")}
                </Text>
                <Text
                  style={{
                    color:
                      stripeStatus === "ready_for_payouts"
                        ? "#22C55E"
                        : stripeStatus === "restricted" || stripeStatus === "disabled"
                          ? APP_COLORS.danger
                          : "#EAB308",
                    fontWeight: "800",
                  }}
                >
                  {stripeLabel}
                </Text>
                <Text style={{ color: APP_COLORS.textMuted }}>{stripeMessage}</Text>
                <TouchableOpacity
                  onPress={() => void onOpenStripe()}
                  disabled={stripeBusy}
                  style={{
                    alignSelf: "flex-start",
                    marginTop: 4,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: APP_COLORS.border,
                    backgroundColor: "rgba(59,130,246,0.14)",
                    opacity: stripeBusy ? 0.65 : 1,
                  }}
                >
                  <Text style={{ color: APP_COLORS.text, fontWeight: "800" }}>
                    {stripeStatus === "ready_for_payouts"
                      ? t("seller.dashboard.manageBank", "Manage bank account")
                      : t("seller.dashboard.setupPayouts", "Set up payouts")}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {seller && canToggleShop ? (
              <View
                style={{
                  backgroundColor: APP_COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: APP_COLORS.border,
                  flexDirection: rowDirection(),
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: APP_COLORS.text, fontWeight: "700" }}>
                    {t("seller.dashboard.shopOpenTitle", "Shop open to clients")}
                  </Text>
                  <Text style={{ color: APP_COLORS.textMuted, marginTop: 4 }}>
                    {seller.is_accepting_orders
                      ? t("seller.dashboard.shopOpenOn", "Clients can browse your active products.")
                      : t("seller.dashboard.shopOpenOff", "Your shop is closed to new client orders.")}
                  </Text>
                </View>
                <Switch
                  value={Boolean(seller.is_accepting_orders)}
                  disabled={togglingShop}
                  onValueChange={(value) => {
                    void onToggleShopOpen(value);
                  }}
                  trackColor={{ false: "#475569", true: APP_COLORS.accentStrong }}
                  thumbColor={APP_COLORS.text}
                />
              </View>
            ) : null}

            <View style={{ flexDirection: rowDirection(), gap: 12 }}>
              <StatCard label={t("seller.stats.products", "Products")} value={productCount} />
              <StatCard label={t("seller.stats.orders", "Orders")} value={orderCount} />
            </View>

            <TouchableOpacity
              disabled={!canManageProducts}
              onPress={() => navigation.navigate("SellerProducts")}
              style={buttonStyle(!canManageProducts)}
            >
              <Text style={{ color: APP_COLORS.onAccent, fontWeight: "700" }}>
                {t("seller.actions.products", "Manage products")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!seller}
              onPress={() => navigation.navigate("SellerOnboarding", { mode: "edit" })}
              style={buttonStyle(!seller, true)}
            >
              <Text style={{ color: APP_COLORS.onAccent, fontWeight: "700" }}>
                {t("seller.actions.editProfile", "Edit business profile")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("SellerOrders")}
              style={buttonStyle(false, true)}
            >
              <Text style={{ color: APP_COLORS.onAccent, fontWeight: "700" }}>
                {t("seller.actions.orders", "View orders")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("SellerWallet")}
              style={buttonStyle(false, true)}
            >
              <Text style={{ color: APP_COLORS.onAccent, fontWeight: "700" }}>
                {t("seller.actions.wallet", "Seller wallet")}
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
        backgroundColor: APP_COLORS.surface,
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: APP_COLORS.border,
      }}
    >
      <Text style={{ color: APP_COLORS.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: APP_COLORS.text, fontSize: 24, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

function buttonStyle(disabled: boolean, secondary = false) {
  return {
    backgroundColor: secondary ? APP_COLORS.borderMuted : disabled ? "#4C1D95" : APP_COLORS.accentStrong,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center" as const,
    opacity: disabled ? 0.5 : 1,
  };
}
