import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  StatusBar,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  Image,
  TextInput,
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
import { MarketplaceBrandState } from "../../components/marketplace/MarketplaceBrandState";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
} from "../../theme/mmdUi";

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
  // Guests may browse the public catalog without platform scope (Apple 5.1.1(v)).
  const guestBrowse = features?.error === "not_authenticated";
  const marketplaceEnabled =
    guestBrowse ||
    Boolean(features?.ok !== false && features?.marketplace_available);
  const [sellers, setSellers] = useState<MarketplaceSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
      const scoped =
        !guestBrowse && market.countryCode
          ? items.filter(
              (seller) =>
                String(seller.country_code ?? "").trim().toUpperCase() ===
                market.countryCode
            )
          : items;
      setSellers(sortSellers(scoped));
    } catch (e) {
      const message = toUserFacingError(
        e,
        t("marketplace.home.loadError", "Unable to load marketplace")
      );
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
  }, [guestBrowse, market.countryCode, marketplaceEnabled, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSellers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sellers;
    return sellers.filter((seller) => {
      const hay = [
        seller.business_name,
        seller.city,
        seller.country_code,
        seller.address,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [query, sellers]);

  const openCount = filteredSellers.filter((s) => s.is_accepting_orders).length;

  const listHeader = (
    <View style={styles.headerBlock}>
      {guestBrowse ? (
        <Text style={styles.guestHint}>
          {t(
            "marketplace.home.guestBrowseHint",
            "Browse shops and products freely. Sign in when you are ready to order.",
          )}
        </Text>
      ) : (
        <MarketScopeCard
          market={market}
          areaLabel={t("marketplace.home.market", "Your market")}
          currencyLabel={t("marketplace.home.currency", "Currency")}
          loading={scopeLoading}
        />
      )}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("marketplace.home.searchPlaceholder", "Search shops…")}
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      {!loading && !error && filteredSellers.length > 0 ? (
        <Text style={styles.openCount}>
          {t("marketplace.home.openCount", "{{open}} open · {{total}} shops", {
            open: openCount,
            total: filteredSellers.length,
          })}
        </Text>
      ) : null}

      {!guestBrowse ? (
        <TouchableOpacity
          onPress={() => navigation.navigate("SellerGate" as never)}
          style={styles.sellCta}
        >
          <Text style={styles.sellCtaText}>
            {t("marketplace.home.sellCta", "Sell on MMD →")}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("marketplace.home.title", "Marketplace")}
        subtitle={t(
          "marketplace.home.subtitle",
          "Shop approved local sellers on MMD.",
        )}
        fallbackRoute={guestBrowse ? "RoleSelect" : "ClientHome"}
        variant="mmd"
      />
      <FlatList
        data={loading || error ? [] : filteredSellers}
        keyExtractor={(item) => item.id}
        {...MARKETPLACE_LIST_PERF}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={MMD_LINK_BLUE}
          />
        }
        contentContainerStyle={styles.list}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <MarketplaceBrandState
              mode="loading"
              message={t("marketplace.home.loading", "Loading marketplace...")}
            />
          ) : error ? (
            <MarketplaceBrandState
              mode="error"
              title={t(
                "marketplace.home.errorTitle",
                "Couldn’t load marketplace",
              )}
              message={error}
              onRetry={() => void load()}
              retryLabel={t("common.retry", "Retry")}
            />
          ) : (
            <MarketplaceBrandState
              mode="empty"
              title={t(
                "marketplace.home.emptyOpen",
                "No approved shops in your area yet.",
              )}
              message={t(
                "marketplace.home.emptyHint",
                "Try again later or check a nearby area.",
              )}
            />
          )
        }
        renderItem={({ item: seller }) => {
          const isOpen = Boolean(seller.is_accepting_orders);
          const productCount = seller.active_product_count ?? 0;
          const logoUrl = String(
            seller.logo_url || seller.cover_image_url || "",
          ).trim();

          return (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("MarketplaceProductList", {
                  sellerId: seller.id,
                  sellerName: seller.business_name,
                  sellerCountryCode: seller.country_code,
                  sellerIsOpen: isOpen,
                })
              }
              style={[
                styles.sellerCard,
                isOpen ? styles.sellerOpen : styles.sellerClosed,
              ]}
            >
              {logoUrl ? (
                <Image
                  source={{ uri: logoUrl }}
                  style={styles.sellerLogo}
                  resizeMode="cover"
                  accessibilityLabel={seller.business_name}
                />
              ) : null}
              <View style={styles.titleRow}>
                <Text style={styles.sellerName} numberOfLines={2}>
                  {seller.business_name}
                </Text>
                <Text style={isOpen ? styles.statusOpen : styles.statusClosed}>
                  {isOpen
                    ? t("marketplace.home.shopOpen", "Open")
                    : t("marketplace.home.shopClosed", "Closed")}
                </Text>
              </View>
              <Text style={styles.cityLine}>
                {seller.city}, {seller.country_code}
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                {seller.address}
              </Text>
              <Text style={styles.meta}>
                {t(
                  "marketplace.home.productCount",
                  "{{count}} products available",
                  { count: productCount },
                )}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  list: { padding: 20, paddingTop: 8, gap: 12 },
  headerBlock: { gap: 12, marginBottom: 12 },
  guestHint: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_TEXT,
    fontFamily: MMD_FONT.regular,
    fontSize: 15,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  openCount: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  sellCta: { alignSelf: "flex-start", marginBottom: 8 },
  sellCtaText: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
  sellerCard: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  sellerOpen: {
    backgroundColor: "rgba(114,159,250,0.15)",
    opacity: 1,
  },
  sellerClosed: {
    backgroundColor: "rgba(0,51,153,0.8)",
    opacity: 0.85,
  },
  titleRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    width: "100%",
  },
  sellerLogo: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 4,
  },
  sellerName: {
    color: MMD_TEXT,
    fontSize: 18,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    flex: 1,
    minWidth: 0,
  },
  statusOpen: {
    color: "#86EFAC",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  statusClosed: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  cityLine: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  meta: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
});
