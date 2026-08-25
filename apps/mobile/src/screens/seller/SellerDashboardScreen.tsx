import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  StatusBar,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  SellerBottomNav,
  SellerBrandHeader,
  SellerContentWrap,
  SellerFeedbackCard,
  SellerGlassCard,
} from "../../components/seller/SellerChrome";
import {
  loadOwnSeller,
  loadSellerDashboardCounts,
  requireSellerPlatformEnabled,
  setSellerAcceptingOrders,
} from "../../lib/sellerApi";
import { sellerStatusLabel, type SellerRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";
import { setLocaleForRoleAndApply } from "../../i18n";
import LanguagePicker from "../../components/LanguagePicker";
import type { AppLanguageCode } from "../../i18n/languageOptions";
import { startStripeOnboarding } from "../../utils/stripe";
import { supabase } from "../../lib/supabase";
import {
  normalizeStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
  type StripeConnectStatusCode,
} from "../../lib/stripeConnectStatus";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  confirmSignOutToRoleSelect,
  sellerSignOutLabels,
} from "../../lib/confirmSignOutToRoleSelect";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
  const { t, i18n } = useTranslation();
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
    } catch {
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
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <SellerBrandHeader
        subtitle={t("seller.dashboard.title", "Seller Dashboard")}
        showBack={false}
        rightSlot={
          <TouchableOpacity
            onPress={() =>
              confirmSignOutToRoleSelect({
                navigation,
                labels: sellerSignOutLabels(t),
                formatError: (e, fb) => toUserFacingError(e, fb),
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t("seller.signOut.title", "Log out")}
          >
            <Text style={styles.logoutLink}>
              {t("seller.signOut.title", "Log out")}
            </Text>
          </TouchableOpacity>
        }
      />

      {loading ? (
        <SellerFeedbackCard
          loading
          title={t("common.loading", "Loading...")}
          message={t("seller.dashboard.loading", "Loading dashboard")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <SellerContentWrap style={{ gap: 16 }}>
          <SellerGlassCard style={styles.shopCard}>
            <View style={styles.shopTop}>
              <View style={styles.shopIcon}>
                <Text style={styles.emoji}>🏪</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shopName}>
                  {seller?.business_name ?? "—"}
                </Text>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: seller?.is_accepting_orders
                          ? MMD_TAXI_GREEN
                          : "rgba(255,255,255,0.4)",
                      },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {seller?.is_accepting_orders
                      ? t("seller.dashboard.openForOrders", "Open for orders")
                      : sellerStatusLabel(seller?.status ?? "pending")}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.statusBody}>
              {statusMessage(seller?.status ?? "pending", t)}
            </Text>
            {!platformOk ? (
              <Text style={styles.danger}>
                {t(
                  "seller.dashboard.platformOff",
                  "Seller services are disabled in your region."
                )}
              </Text>
            ) : null}
          </SellerGlassCard>

          <View style={styles.kpiRow}>
            <SellerGlassCard style={styles.kpiCard}>
              <View style={styles.kpiIcon}>
                <Text style={styles.emoji}>📦</Text>
              </View>
              <Text style={styles.kpiValue}>{orderCount}</Text>
              <Text style={styles.kpiLabel}>
                {t("seller.stats.orders", "Total Orders")}
              </Text>
            </SellerGlassCard>
            <SellerGlassCard style={styles.kpiCard}>
              <View style={styles.kpiIcon}>
                <Text style={styles.emoji}>🛍️</Text>
              </View>
              <Text style={styles.kpiValue}>{productCount}</Text>
              <Text style={styles.kpiLabel}>
                {t("seller.stats.products", "Products")}
              </Text>
            </SellerGlassCard>
          </View>

          {seller && canManageProducts ? (
            <SellerGlassCard style={{ gap: 10 }}>
              <Text style={styles.sectionTitle}>
                {t("seller.dashboard.payoutsTitle", "Payouts (Stripe Connect)")}
              </Text>
              <Text
                style={{
                  color:
                    stripeStatus === "ready_for_payouts"
                      ? MMD_TAXI_GREEN
                      : stripeStatus === "restricted" || stripeStatus === "disabled"
                        ? "#EF4444"
                        : "#EAB308",
                  fontFamily: MMD_FONT.bold,
                  fontWeight: "700",
                }}
              >
                {stripeLabel}
              </Text>
              <Text style={styles.muted}>{stripeMessage}</Text>
              {stripeStatus !== "ready_for_payouts" ? (
                <Text style={styles.danger}>
                  {t(
                    "seller.dashboard.payoutBlocked",
                    "Payouts are blocked until Stripe Connect is complete. Earnings stay on the ledger and retry automatically after onboarding.",
                  )}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={() => void onOpenStripe()}
                disabled={stripeBusy}
                style={[styles.outlineBtn, stripeBusy && { opacity: 0.65 }]}
              >
                <Text style={styles.outlineLabel}>
                  {stripeStatus === "ready_for_payouts"
                    ? t("seller.dashboard.manageBank", "Manage bank account")
                    : t("seller.dashboard.setupPayouts", "Set up payouts")}
                </Text>
              </TouchableOpacity>
            </SellerGlassCard>
          ) : null}

          {seller && canToggleShop ? (
            <SellerGlassCard
              style={{
                flexDirection: rowDirection(),
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  {t("seller.dashboard.shopOpenTitle", "Shop open to clients")}
                </Text>
                <Text style={styles.muted}>
                  {seller.is_accepting_orders
                    ? t(
                        "seller.dashboard.shopOpenOn",
                        "Clients can browse your active products."
                      )
                    : t(
                        "seller.dashboard.shopOpenOff",
                        "Your shop is closed to new client orders."
                      )}
                </Text>
              </View>
              <Switch
                value={Boolean(seller.is_accepting_orders)}
                disabled={togglingShop}
                onValueChange={(value) => {
                  void onToggleShopOpen(value);
                }}
                trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
                thumbColor={MMD_WHITE}
              />
            </SellerGlassCard>
          ) : null}

          <View style={styles.actions}>
            <ActionTile
              icon="🛍️"
              title={t("seller.actions.products", "Products")}
              subtitle={t("seller.actions.productsHint", "Manage your catalog")}
              disabled={!canManageProducts}
              onPress={() => navigation.navigate("SellerProducts")}
            />
            <ActionTile
              icon="📋"
              title={t("seller.actions.orders", "Orders")}
              subtitle={t("seller.actions.ordersHint", "View all orders")}
              onPress={() => navigation.navigate("SellerOrders")}
            />
            <ActionTile
              icon="💳"
              title={t("seller.actions.wallet", "Wallet")}
              subtitle={t("seller.actions.walletHint", "Payments & payouts")}
              onPress={() => navigation.navigate("SellerWallet")}
            />
            <ActionTile
              icon="✏️"
              title={t("seller.actions.editProfile", "Edit Shop")}
              subtitle={t("seller.actions.editHint", "Update shop details")}
              disabled={!seller}
              onPress={() =>
                navigation.navigate("SellerOnboarding", { mode: "edit" })
              }
            />
          </View>

          <SellerGlassCard style={{ gap: 12 }}>
            <Text style={styles.sectionTitle}>
              {t("seller.dashboard.language", "Language")}
            </Text>
            <LanguagePicker
              currentCode={String(i18n.resolvedLanguage || i18n.language || "en")}
              onSelect={async (code: AppLanguageCode) => {
                await setLocaleForRoleAndApply("seller", code);
              }}
              variant="mmdHome"
              hideTitle
            />
          </SellerGlassCard>
          </SellerContentWrap>
        </ScrollView>
      )}

      <SellerBottomNav active="home" />
    </SafeAreaView>
  );
}

function ActionTile({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionTile, disabled && { opacity: 0.45 }]}
      accessibilityRole="button"
    >
      <View style={styles.actionIcon}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSub}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 16, paddingBottom: 24, gap: 16 },
  shopCard: { gap: 12, borderRadius: 20 },
  shopTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  shopIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 18 },
  shopName: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  statusBody: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    lineHeight: 18,
  },
  danger: { color: "#FCA5A5", marginTop: 4, fontSize: 13 },
  logoutLink: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  kpiRow: { flexDirection: "row", gap: 12 },
  kpiCard: { flex: 1, gap: 10, borderRadius: 20 },
  kpiIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: {
    color: MMD_WHITE,
    fontSize: 28,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  kpiLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  muted: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    marginTop: 4,
  },
  outlineBtn: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: MMD_GLASS,
  },
  outlineLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  actionTile: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  actionSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
});
