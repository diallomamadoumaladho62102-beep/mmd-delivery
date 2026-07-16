import React, { useEffect, useMemo, useState } from "react";
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
import {
  loadOwnSeller,
  upsertSellerOnboarding,
  updateSellerProfile,
  requireSellerPlatformEnabled,
} from "../../lib/sellerApi";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import MarketScopeCard from "../../components/market/MarketScopeCard";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { UiLoadingState } from "../../components/ui/UiStates";
import { APP_COLORS } from "../../theme/appTheme";

type Props = { navigation: any; route?: { params?: { mode?: "edit" } } };

export default function SellerOnboardingScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const editMode = route?.params?.mode === "edit";
  const { features, loading: scopeLoading } = useClientPlatformFeatures();
  const market = useMemo(() => resolveMarketScopeFromFeatures(features), [features]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [documentUrlsText, setDocumentUrlsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(editMode);

  useEffect(() => {
    if (!editMode) return;
    void (async () => {
      try {
        setHydrating(true);
        const seller = await loadOwnSeller();
        if (!seller) {
          navigation.replace("SellerOnboarding");
          return;
        }
        setSellerId(seller.id);
        setBusinessName(seller.business_name);
        setCity(seller.city);
        setAddress(seller.address);
        setPhone(seller.phone);
        setLogoUrl(seller.logo_url ?? "");
        setCoverUrl(seller.cover_image_url ?? "");
        setDocumentUrlsText(
          Array.isArray(seller.document_urls)
            ? (seller.document_urls as unknown[]).map(String).join("\n")
            : ""
        );
      } catch (e: any) {
        Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Load failed");
      } finally {
        setHydrating(false);
      }
    })();
  }, [editMode, navigation, t]);

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

    if (!editMode && (!market.scopeResolved || !market.countryCode)) {
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
      const document_urls = documentUrlsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (editMode && sellerId) {
        await updateSellerProfile({
          sellerId,
          business_name: businessName,
          city,
          address,
          phone,
          logo_url: logoUrl,
          cover_image_url: coverUrl,
          document_urls,
        });
        Alert.alert(
          t("seller.onboarding.updatedTitle", "Profile updated"),
          t("seller.onboarding.updatedBody", "Your business profile was saved."),
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      } else {
        await upsertSellerOnboarding({
          business_name: businessName,
          country_code: market.countryCode!,
          city,
          address,
          phone,
          logo_url: logoUrl,
          cover_image_url: coverUrl,
          document_urls,
        });
        Alert.alert(
          t("seller.onboarding.submittedTitle", "Application submitted"),
          t(
            "seller.onboarding.submittedBody",
            "Your seller profile is pending admin review."
          ),
          [{ text: "OK", onPress: () => navigation.replace("SellerDashboard") }]
        );
      }
    } catch (e: any) {
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Submit failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_COLORS.bg }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={
          editMode
            ? t("seller.onboarding.editTitle", "Edit seller profile")
            : t("seller.onboarding.title", "Become a Seller")
        }
        subtitle={
          editMode
            ? t("seller.onboarding.editSubtitle", "Update business details and image URLs.")
            : t(
                "seller.onboarding.subtitle",
                "Register your business to sell on MMD Marketplace."
              )
        }
        fallbackRoute="SellerDashboard"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>
        {hydrating ? (
          <UiLoadingState />
        ) : (
          <>
            {!editMode ? (
              <MarketScopeCard
                market={market}
                areaLabel={t("seller.onboarding.market", "Your market")}
                currencyLabel={t("seller.onboarding.currency", "Currency")}
                loading={scopeLoading}
              />
            ) : null}

            {(
              [
                [t("seller.fields.businessName", "Business name"), businessName, setBusinessName, false],
                [t("seller.fields.city", "City"), city, setCity, false],
                [t("seller.fields.address", "Address"), address, setAddress, false],
                [t("seller.fields.phone", "Phone"), phone, setPhone, false],
                [t("seller.fields.logoUrl", "Logo URL"), logoUrl, setLogoUrl, false],
                [t("seller.fields.coverUrl", "Cover image URL"), coverUrl, setCoverUrl, false],
                [
                  t("seller.fields.documentUrls", "Document URLs (one per line)"),
                  documentUrlsText,
                  setDocumentUrlsText,
                  true,
                ],
              ] as const
            ).map(([label, value, setter, multiline]) => (
              <View key={label}>
                <Text style={{ color: APP_COLORS.textSubtle, marginBottom: 6 }}>{label}</Text>
                <TextInput
                  value={value}
                  onChangeText={setter}
                  autoCapitalize="none"
                  multiline={multiline}
                  style={{
                    backgroundColor: APP_COLORS.surface,
                    borderRadius: 12,
                    padding: 14,
                    color: APP_COLORS.text,
                    borderWidth: 1,
                    borderColor: APP_COLORS.border,
                    minHeight: multiline ? 88 : undefined,
                  }}
                />
              </View>
            ))}

            <TouchableOpacity
              onPress={submit}
              disabled={loading || (!editMode && !market.scopeResolved)}
              style={{
                backgroundColor: APP_COLORS.accentStrong,
                padding: 16,
                borderRadius: 14,
                alignItems: "center",
                opacity: loading || (!editMode && !market.scopeResolved) ? 0.6 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color={APP_COLORS.onAccent} />
              ) : (
                <Text style={{ color: APP_COLORS.onAccent, fontWeight: "800" }}>
                  {editMode
                    ? t("seller.onboarding.save", "Save profile")
                    : t("seller.onboarding.submit", "Submit application")}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
