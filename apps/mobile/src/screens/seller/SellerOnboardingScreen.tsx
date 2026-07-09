import React, { useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { upsertSellerOnboarding, requireSellerPlatformEnabled } from "../../lib/sellerApi";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import MarketScopeCard from "../../components/market/MarketScopeCard";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Props = { navigation: any };

export default function SellerOnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const gate = await requireSellerPlatformEnabled();
    if (!gate.enabled) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        gate.message ??
          t(
            "seller.gate.unavailable",
            "Marketplace disabled in this county.\n\nYour products remain saved, but customers cannot place new orders until Marketplace is activated."
          )
      );
      return;
    }

    if (!market.scopeResolved || !market.countryCode) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("seller.onboarding.scopeRequired", "Your market must be resolved before applying.")
      );
      return;
    }

    if (!businessName.trim() || !city.trim() || !address.trim() || !phone.trim()) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("seller.onboarding.required", "Please fill in all required fields.")
      );
      return;
    }

    try {
      setLoading(true);
      await upsertSellerOnboarding({
        business_name: businessName,
        country_code: market.countryCode,
        city,
        address,
        phone,
      });
      Alert.alert(
        t("seller.onboarding.submittedTitle", "Application submitted"),
        t(
          "seller.onboarding.submittedBody",
          "Your seller profile is pending admin review."
        ),
        [{ text: "OK", onPress: () => navigation.replace("SellerDashboard") }]
      );
    } catch (e: any) {
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Submit failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.onboarding.title", "Become a Seller")}
        subtitle={t(
          "seller.onboarding.subtitle",
          "Register your business to sell on MMD Marketplace."
        )}
        fallbackRoute="SellerDashboard"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>

        <MarketScopeCard
          market={market}
          areaLabel={t("seller.onboarding.market", "Your market")}
          currencyLabel={t("seller.onboarding.currency", "Currency")}
          loading={scopeLoading}
        />

        {(
          [
            [t("seller.fields.businessName", "Business name"), businessName, setBusinessName],
            [t("seller.fields.city", "City"), city, setCity],
            [t("seller.fields.address", "Address"), address, setAddress],
            [t("seller.fields.phone", "Phone"), phone, setPhone],
          ] as const
        ).map(([label, value, setter]) => (
          <View key={label}>
            <Text style={{ color: "#CBD5E1", marginBottom: 6 }}>{label}</Text>
            <TextInput
              value={value}
              onChangeText={setter}
              style={{
                backgroundColor: "#111827",
                borderRadius: 12,
                padding: 14,
                color: "#F8FAFC",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            />
          </View>
        ))}

        <TouchableOpacity
          onPress={submit}
          disabled={loading || !market.scopeResolved}
          style={{
            backgroundColor: "#7C3AED",
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
            opacity: loading || !market.scopeResolved ? 0.6 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "800" }}>
              {t("seller.onboarding.submit", "Submit application")}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
