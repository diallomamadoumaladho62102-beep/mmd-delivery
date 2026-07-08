import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchMarketplaceSellers,
  type MarketplaceSeller,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import MarketScopeCard from "../../components/market/MarketScopeCard";

type Nav = NativeStackNavigationProp<RootStackParamList, "MarketplaceHome">;

function sortSellers(items: MarketplaceSeller[]) {
  return [...items].sort((a, b) => {
    const openDiff = Number(b.is_accepting_orders) - Number(a.is_accepting_orders);
    if (openDiff !== 0) return openDiff;
    return a.business_name.localeCompare(b.business_name);
  });
}

export default function MarketplaceHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const marketplaceEnabled = Boolean(features.ok !== false && features.marketplace_available);
  const [sellers, setSellers] = useState<MarketplaceSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      if (!marketplaceEnabled) {
        setSellers([]);
        setError(
          t(
            "marketplace.errors.unavailable",
            "Marketplace is not available in your area yet."
          )
        );
        return;
      }

      const items = await fetchMarketplaceSellers();
      const scoped = market.countryCode
        ? items.filter(
            (seller) =>
              String(seller.country_code ?? "").trim().toUpperCase() === market.countryCode
          )
        : items;
      setSellers(sortSellers(scoped));
    } catch (e) {
      const message = toUserFacingError(e, t("marketplace.home.loadError", "Unable to load marketplace"));
      if (message.includes("marketplace_unavailable")) {
        setError(
          t(
            "marketplace.errors.unavailable",
            "Marketplace is not available in your area yet."
          )
        );
      } else {
        setError(message);
      }
      setSellers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market.countryCode, marketplaceEnabled, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = sellers.filter((s) => s.is_accepting_orders).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("marketplace.home.title", "Marketplace")}
        subtitle={t("marketplace.home.subtitle", "Shop approved local sellers on MMD.")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />
        }
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12 }}
      >

        <MarketScopeCard
          market={market}
          areaLabel={t("marketplace.home.market", "Your market")}
          currencyLabel={t("marketplace.home.currency", "Currency")}
          loading={scopeLoading}
        />

        {!loading && !error && sellers.length > 0 ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.home.openCount", "{{open}} open · {{total}} shops", {
              open: openCount,
              total: sellers.length,
            })}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => navigation.navigate("SellerGate" as never)}
          style={{ alignSelf: "flex-start", marginBottom: 8 }}
        >
          <Text style={{ color: "#A78BFA" }}>
            {t("marketplace.home.sellCta", "Sell on MMD →")}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : error ? (
          <Text style={{ color: "#FCA5A5" }}>{error}</Text>
        ) : sellers.length === 0 ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.home.emptyOpen", "No approved shops in your area yet.")}
          </Text>
        ) : (
          sellers.map((seller) => {
            const isOpen = Boolean(seller.is_accepting_orders);
            const productCount = seller.active_product_count ?? 0;

            return (
              <TouchableOpacity
                key={seller.id}
                disabled={!isOpen}
                onPress={() =>
                  navigation.navigate("MarketplaceProductList", {
                    sellerId: seller.id,
                    sellerName: seller.business_name,
                    sellerCountryCode: seller.country_code,
                    sellerIsOpen: isOpen,
                  })
                }
                style={{
                  backgroundColor: isOpen ? "rgba(124,58,237,0.15)" : "rgba(15,23,42,0.8)",
                  borderColor: isOpen ? "rgba(196,181,253,0.25)" : "rgba(100,116,139,0.35)",
                  borderWidth: 1,
                  borderRadius: 16,
                  padding: 16,
                  opacity: isOpen ? 1 : 0.85,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: "#F8FAFC", fontSize: 18, fontWeight: "600", flex: 1 }}>
                    {seller.business_name}
                  </Text>
                  <Text
                    style={{
                      color: isOpen ? "#86EFAC" : "#FCA5A5",
                      fontWeight: "700",
                      fontSize: 12,
                      alignSelf: "flex-start",
                    }}
                  >
                    {isOpen
                      ? t("marketplace.home.shopOpen", "Open")
                      : t("marketplace.home.shopClosed", "Closed")}
                  </Text>
                </View>
                <Text style={{ color: "#CBD5E1", marginTop: 4 }}>
                  {seller.city}, {seller.country_code}
                </Text>
                <Text style={{ color: "#94A3B8", marginTop: 4 }} numberOfLines={2}>
                  {seller.address}
                </Text>
                <Text style={{ color: "#94A3B8", marginTop: 6 }}>
                  {t("marketplace.home.productCount", "{{count}} products available", {
                    count: productCount,
                  })}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
