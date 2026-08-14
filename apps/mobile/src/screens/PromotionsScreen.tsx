import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { toUserFacingError } from "../lib/userFacingError";
import { fetchMarketingSummary, validateMarketingCode } from "../lib/marketingApi";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE_STRONG,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GREEN,
  MMD_GREEN_SOFT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "Promotions">;

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

export default function PromotionsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Array<Record<string, unknown>>>([]);
  const [coupons, setCoupons] = useState<Array<Record<string, unknown>>>([]);
  const [code, setCode] = useState("");

  // List offers/coupons without inventing a demo cart. Eligibility amounts
  // are computed at real checkout (food/marketplace) with live totals.
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchMarketingSummary({
        service: "food",
        subtotalCents: 0,
        deliveryFeeCents: 0,
      });
      setOffers((res.offers as Array<Record<string, unknown>>) ?? []);
      setCoupons((res.coupons as Array<Record<string, unknown>>) ?? []);
    } catch (e: unknown) {
      setError(
        toUserFacingError(
          e,
          t("promotions.loadFailed", "Unable to load promotions."),
        ),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onValidate = useCallback(async () => {
    try {
      const res = await validateMarketingCode({
        service: "food",
        promo_code: code,
        subtotal_cents: 0,
        delivery_fee_cents: 0,
      });
      const disc = Number(res.resolve?.order_discount_cents ?? 0);
      const fee = Number(res.resolve?.delivery_fee_discount_cents ?? 0);
      Alert.alert(
        t("promotions.title", "Promotions"),
        disc + fee > 0
          ? t(
              "promotions.codeAcceptedWithDiscount",
              "Code accepted (−{{orderDiscount}} / −{{deliveryDiscount}} delivery). Exact amount applies at checkout.",
              {
                orderDiscount: `${(disc / 100).toFixed(2)} $`,
                deliveryDiscount: `${(fee / 100).toFixed(2)} $`,
              },
            )
          : t(
              "promotions.codeAccepted",
              "Code accepted. Exact amount applies at checkout based on your cart.",
            ),
      );
    } catch (e: unknown) {
      Alert.alert(
        t("promotions.title", "Promotions"),
        toUserFacingError(e, t("promotions.codeRejected", "Code rejected.")),
      );
    }
  }, [code, t]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader title="Promotions" fallbackRoute="ClientHome" variant="dark" />
      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={MMD_GREEN_SOFT} />
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => void load()}>
            <Text style={styles.btnText}>Réessayer</Text>
          </TouchableOpacity>
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={MMD_GREEN_SOFT}
            />
          }
        >
          <View style={styles.card}>
            <Text style={styles.cardSection}>Promo Code</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              placeholder="CODEPROMO"
              placeholderTextColor={MMD_LINK_BLUE}
            />
            <TouchableOpacity style={styles.btn} onPress={() => void onValidate()}>
              <Text style={styles.btnText}>Verify</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>My Coupons</Text>
          {coupons.length === 0 ? (
            <Text style={styles.muted}>Aucun coupon.</Text>
          ) : (
            coupons.map((c) => (
              <View key={String(c.id)} style={styles.listCard}>
                <Text style={styles.title}>
                  {String(
                    (c.marketing_campaigns as { name?: string } | null)?.name ?? "Coupon"
                  )}
                </Text>
                <Text style={styles.muted}>
                  {c.value_percent != null ? `${c.value_percent}%` : ""}
                  {c.expires_at
                    ? ` · expires ${new Date(String(c.expires_at)).toLocaleDateString()}`
                    : ""}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.section}>Offers</Text>
          {offers.length === 0 ? (
            <Text style={styles.muted}>Aucune offre.</Text>
          ) : (
            offers.map((o) => (
              <View key={String(o.id)} style={styles.listCard}>
                <Text style={styles.title}>{String(o.name)}</Text>
                <Text style={styles.muted}>{String(o.description ?? "")}</Text>
              </View>
            ))
          )}

          <TouchableOpacity
            style={styles.link}
            onPress={() => navigation.navigate("MmdPlus")}
          >
            <Text style={styles.linkText}>See also MMD+</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 10 },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    paddingBottom: 50,
  },
  stateSpacer: { flex: 1, minHeight: 24, width: "100%" },
  footerLogo: { width: 50, height: 50, borderRadius: 25 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  card: {
    backgroundColor: MMD_CARD_ON_BLUE_STRONG,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  listCard: {
    backgroundColor: MMD_CARD_ON_BLUE_STRONG,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  cardSection: {
    color: MMD_TEXT,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  section: {
    color: MMD_TEXT,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    marginTop: 4,
  },
  title: {
    color: MMD_TEXT,
    fontWeight: "700",
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
  },
  muted: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 13,
    marginTop: 0,
    fontFamily: MMD_FONT.regular,
  },
  error: { color: "#FCA5A5", fontFamily: MMD_FONT.bold },
  input: {
    height: 42,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  btn: {
    backgroundColor: MMD_GREEN,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  btnText: {
    color: MMD_BLUE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
  },
  link: { marginTop: 8, alignItems: "flex-start", paddingTop: 8 },
  linkText: {
    color: MMD_GREEN_SOFT,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
  },
});
