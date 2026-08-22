import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
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
import {
  SellerBrandHeader,
  SellerBottomNav,
  SellerContentWrap,
  SellerFeedbackCard,
  SellerGlassCard,
} from "../../components/seller/SellerChrome";
import {
  confirmSignOutToRoleSelect,
  sellerSignOutLabels,
} from "../../lib/confirmSignOutToRoleSelect";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ??
            t("seller.onboarding.loadFailed", "Unable to load your seller profile.")
        );
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
          [{ text: "OK", onPress: () => navigation.navigate("SellerDashboard") }]
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
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ??
          t("seller.onboarding.submitFailed", "Unable to submit your application.")
      );
    } finally {
      setLoading(false);
    }
  };

  const fields = (
    [
      [
        t("seller.fields.businessName", "Shop Name"),
        businessName,
        setBusinessName,
        t("seller.fields.businessNamePh", "Enter shop name"),
        false,
      ],
      [
        t("seller.fields.address", "Address"),
        address,
        setAddress,
        t("seller.fields.addressPh", "Describe your shop address"),
        false,
      ],
      [
        t("seller.fields.city", "City"),
        city,
        setCity,
        t("seller.fields.cityPh", "Enter city"),
        false,
      ],
      [
        t("seller.fields.phone", "Phone"),
        phone,
        setPhone,
        t("seller.fields.phonePh", "Enter phone"),
        false,
      ],
      [
        t("seller.fields.logoUrl", "Logo URL"),
        logoUrl,
        setLogoUrl,
        t("seller.fields.logoUrlPh", "https://…"),
        false,
      ],
      [
        t("seller.fields.coverUrl", "Cover image URL"),
        coverUrl,
        setCoverUrl,
        t("seller.fields.coverUrlPh", "https://…"),
        false,
      ],
      [
        t("seller.fields.documentUrls", "Document URLs (one per line)"),
        documentUrlsText,
        setDocumentUrlsText,
        t("seller.fields.documentUrlsPh", "https://…"),
        true,
      ],
    ] as const
  );

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <SellerBrandHeader
        subtitle={t("seller.onboarding.headerSubtitle", "Seller Setup")}
        showBack
        fallbackRoute="SellerDashboard"
      />
      {hydrating ? (
        <SellerFeedbackCard
          loading
          title={t("common.loading", "Loading...")}
          message={t("seller.onboarding.loadingProfile", "Loading profile")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SellerContentWrap style={{ gap: 16 }}>
          <SellerGlassCard style={styles.formCard}>
            <View style={styles.cardHeader}>
              <View style={styles.shopIcon}>
                <Text style={styles.shopEmoji}>🏪</Text>
              </View>
              <Text style={styles.cardTitle}>
                {editMode
                  ? t("seller.onboarding.editCardTitle", "Edit Your Shop")
                  : t("seller.onboarding.createCardTitle", "Create Your Shop")}
              </Text>
            </View>

            {!editMode ? (
              <MarketScopeCard
                market={market}
                areaLabel={t("seller.onboarding.market", "Your market")}
                currencyLabel={t("seller.onboarding.currency", "Currency")}
                loading={scopeLoading}
              />
            ) : null}

            {fields.map(([label, value, setter, placeholder, multiline]) => (
              <View key={label} style={styles.field}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  value={value}
                  onChangeText={setter}
                  autoCapitalize="none"
                  multiline={multiline}
                  placeholder={placeholder}
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={[styles.input, multiline ? styles.inputMultiline : null]}
                />
              </View>
            ))}
          </SellerGlassCard>

          <TouchableOpacity
            onPress={submit}
            disabled={loading || (!editMode && !market.scopeResolved)}
            style={[
              styles.submit,
              (loading || (!editMode && !market.scopeResolved)) && styles.submitDisabled,
            ]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text style={styles.submitLabel}>
                {editMode
                  ? t("seller.onboarding.save", "Save profile")
                  : t("seller.onboarding.submit", "Create Seller Profile")}
              </Text>
            )}
          </TouchableOpacity>

          {editMode ? (
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() =>
                confirmSignOutToRoleSelect({
                  navigation,
                  labels: sellerSignOutLabels(t),
                  formatError: (e, fb) => toUserFacingError(e, fb),
                })
              }
              accessibilityRole="button"
            >
              <Text style={styles.logoutLabel}>
                {t("seller.signOut.title", "Log out")}
              </Text>
            </TouchableOpacity>
          ) : null}
          </SellerContentWrap>
        </ScrollView>
      )}
      {editMode ? <SellerBottomNav active="profile" /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 16, paddingBottom: 40, gap: 24 },
  formCard: { gap: 16, padding: 24, borderRadius: 24 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  shopIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  shopEmoji: { fontSize: 20 },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  field: { gap: 6, width: "100%" },
  label: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 14,
    padding: 14,
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  submit: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.6 },
  submitLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  logoutBtn: {
    marginTop: 8,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.45)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  logoutLabel: {
    color: "#FCA5A5",
    fontSize: 15,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});
