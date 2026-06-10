import React, { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { upsertSellerOnboarding } from "../../lib/sellerApi";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

export default function SellerOnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [businessName, setBusinessName] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
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
        country_code: countryCode,
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ color: "#F8FAFC", fontSize: 24, fontWeight: "800" }}>
          {t("seller.onboarding.title", "Become a Seller")}
        </Text>
        <Text style={{ color: "#94A3B8", marginBottom: 8 }}>
          {t(
            "seller.onboarding.subtitle",
            "Register your business to sell on MMD Marketplace."
          )}
        </Text>

        {(
          [
            [t("seller.fields.businessName", "Business name"), businessName, setBusinessName],
            [t("seller.fields.country", "Country code"), countryCode, setCountryCode],
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
              autoCapitalize="words"
              style={{
                backgroundColor: "#111827",
                color: "#F8FAFC",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            />
          </View>
        ))}

        <TouchableOpacity
          onPress={() => void submit()}
          disabled={loading}
          style={{
            marginTop: 12,
            backgroundColor: "#7C3AED",
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: "center",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              {t("seller.onboarding.submit", "Submit for review")}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
