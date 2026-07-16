import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  loadOwnSeller,
  loadSellerProducts,
  saveSellerProduct,
  toggleSellerProductActive,
} from "../../lib/sellerApi";
import { formatMoney, type SellerProductRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { UiEmptyState, UiLoadingState } from "../../components/ui/UiStates";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import { APP_COLORS } from "../../theme/appTheme";

type Props = { navigation: any };

type ProductDraft = {
  id?: string;
  title: string;
  description: string;
  price: string;
  promoPrice: string;
  currency: string;
  category: string;
  imageUrl: string;
  stockQty: string;
  optionsText: string;
  variantsText: string;
  active: boolean;
};

const EMPTY_DRAFT: ProductDraft = {
  title: "",
  description: "",
  price: "",
  promoPrice: "",
  currency: "USD",
  category: "general",
  imageUrl: "",
  stockQty: "",
  optionsText: "",
  variantsText: "",
  active: true,
};

export default function SellerProductsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [products, setProducts] = useState<SellerProductRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const seller = await loadOwnSeller();
      if (!seller) {
        navigation.replace("SellerOnboarding");
        return;
      }
      if (seller.status !== "approved") {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("seller.products.notApproved", "Your seller account must be approved first.")
        );
        navigation.goBack();
        return;
      }
      setSellerId(seller.id);
      setProducts(await loadSellerProducts(seller.id));
    } catch (e: any) {
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Load failed");
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  };

  const openEdit = (product: SellerProductRow) => {
    const options = Array.isArray(product.options_json)
      ? (product.options_json as unknown[]).map(String).join("\n")
      : "";
    const variants = Array.isArray(product.variants_json)
      ? (product.variants_json as unknown[]).map(String).join("\n")
      : "";
    setDraft({
      id: product.id,
      title: product.title,
      description: product.description,
      price: String((product.price_cents / 100).toFixed(2)),
      promoPrice:
        product.promo_price_cents == null
          ? ""
          : String((product.promo_price_cents / 100).toFixed(2)),
      currency: product.currency,
      category: product.category,
      imageUrl: product.image_paths?.[0] ?? "",
      stockQty: product.stock_qty == null ? "" : String(product.stock_qty),
      optionsText: options,
      variantsText: variants,
      active: product.active,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!sellerId) return;
    const priceCents = Math.round(Number(draft.price) * 100);
    if (!draft.title.trim() || !Number.isFinite(priceCents) || priceCents < 0) {
      Alert.alert(t("common.errorTitle", "Error"), t("seller.products.invalid", "Invalid product data"));
      return;
    }

    const promoRaw = draft.promoPrice.trim();
    const promoPriceCents =
      promoRaw === "" ? null : Math.round(Number(promoRaw) * 100);
    if (promoRaw !== "" && (!Number.isFinite(promoPriceCents) || (promoPriceCents ?? 0) < 0)) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("seller.products.invalidPromo", "Invalid promo price")
      );
      return;
    }

    const stockRaw = draft.stockQty.trim();
    const stockQty =
      stockRaw === ""
        ? null
        : Math.max(0, Math.round(Number(stockRaw)));
    if (stockRaw !== "" && !Number.isFinite(stockQty)) {
      Alert.alert(t("common.errorTitle", "Error"), t("seller.products.invalidStock", "Invalid stock quantity"));
      return;
    }

    const options_json = draft.optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const variants_json = draft.variantsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    try {
      setSaving(true);
      await saveSellerProduct(sellerId, {
        id: draft.id,
        title: draft.title,
        description: draft.description,
        price_cents: priceCents,
        promo_price_cents: promoPriceCents,
        currency: draft.currency,
        category: draft.category,
        image_paths: draft.imageUrl.trim() ? [draft.imageUrl.trim()] : [],
        active: draft.active,
        stock_qty: stockQty,
        options_json,
        variants_json,
      });
      setModalOpen(false);
      await refresh();
    } catch (e: any) {
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: SellerProductRow) => {
    if (!sellerId) return;
    try {
      await toggleSellerProductActive(sellerId, product.id, !product.active);
      await refresh();
    } catch (e: any) {
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Update failed");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_COLORS.bg }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.products.title", "Products")}
        fallbackRoute="SellerDashboard"
        variant="dark"
        rightSlot={
          <TouchableOpacity onPress={openCreate}>
            <Text style={{ color: APP_COLORS.accent, fontSize: 24, fontWeight: "700" }}>+</Text>
          </TouchableOpacity>
        }
      />

      {loading ? (
        <UiLoadingState style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          {...MARKETPLACE_LIST_PERF}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <UiEmptyState
              title={t("seller.products.empty", "No products yet.")}
              style={{ marginTop: 24 }}
            />
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: APP_COLORS.surface,
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: APP_COLORS.border,
              }}
            >
              <Text style={{ color: APP_COLORS.text, fontWeight: "700" }}>{item.title}</Text>
              <Text style={{ color: APP_COLORS.textMuted, marginVertical: 4 }}>
                {formatMoney(item.price_cents, item.currency)} · {item.category}
                {item.stock_qty != null ? ` · stock ${item.stock_qty}` : ""}
              </Text>
              <Text style={{ color: APP_COLORS.textSubtle }} numberOfLines={2}>
                {item.description}
              </Text>
              <View style={{ flexDirection: rowDirection(), gap: 10, marginTop: 10 }}>
                <TouchableOpacity onPress={() => openEdit(item)}>
                  <Text style={{ color: APP_COLORS.accent }}>{t("common.edit", "Edit")}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void toggleActive(item)}>
                  <Text style={{ color: item.active ? APP_COLORS.danger : APP_COLORS.success }}>
                    {item.active
                      ? t("seller.products.deactivate", "Deactivate")
                      : t("seller.products.activate", "Activate")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: APP_COLORS.overlay, justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: APP_COLORS.surface, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 10 }}>
            <Text style={{ color: APP_COLORS.text, fontSize: 18, fontWeight: "700" }}>
              {draft.id
                ? t("seller.products.editTitle", "Edit product")
                : t("seller.products.createTitle", "New product")}
            </Text>
            {(
              [
                ["title", draft.title, (v: string) => setDraft((d) => ({ ...d, title: v }))],
                ["description", draft.description, (v: string) => setDraft((d) => ({ ...d, description: v }))],
                ["price", draft.price, (v: string) => setDraft((d) => ({ ...d, price: v }))],
                ["promoPrice", draft.promoPrice, (v: string) => setDraft((d) => ({ ...d, promoPrice: v }))],
                ["currency", draft.currency, (v: string) => setDraft((d) => ({ ...d, currency: v }))],
                ["category", draft.category, (v: string) => setDraft((d) => ({ ...d, category: v }))],
                ["stockQty", draft.stockQty, (v: string) => setDraft((d) => ({ ...d, stockQty: v }))],
                ["optionsText", draft.optionsText, (v: string) => setDraft((d) => ({ ...d, optionsText: v }))],
                ["variantsText", draft.variantsText, (v: string) => setDraft((d) => ({ ...d, variantsText: v }))],
                ["imageUrl", draft.imageUrl, (v: string) => setDraft((d) => ({ ...d, imageUrl: v }))],
              ] as const
            ).map(([key, value, onChangeText]) => (
              <TextInput
                key={key}
                value={value}
                onChangeText={onChangeText}
                placeholder={
                  key === "optionsText"
                    ? "options (one per line)"
                    : key === "variantsText"
                      ? "variants (one per line)"
                      : key === "stockQty"
                        ? "stock qty (optional)"
                        : key === "promoPrice"
                          ? "promo price (optional)"
                          : key
                }
                placeholderTextColor="#64748B"
                multiline={
                  key === "optionsText" ||
                  key === "variantsText" ||
                  key === "description"
                }
                style={{
                  backgroundColor: APP_COLORS.surfaceAlt,
                  color: APP_COLORS.text,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  minHeight:
                    key === "optionsText" || key === "variantsText" ? 72 : undefined,
                }}
              />
            ))}
            <View style={{ flexDirection: rowDirection(), alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: APP_COLORS.textSubtle }}>{t("seller.products.active", "Active")}</Text>
              <Switch value={draft.active} onValueChange={(active) => setDraft((d) => ({ ...d, active }))} />
            </View>
            <TouchableOpacity
              onPress={() => void save()}
              disabled={saving}
              style={{
                backgroundColor: APP_COLORS.accentStrong,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              {saving ? (
                <ActivityIndicator color={APP_COLORS.onAccent} />
              ) : (
                <Text style={{ color: APP_COLORS.onAccent, fontWeight: "700" }}>{t("common.save", "Save")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalOpen(false)}>
              <Text style={{ color: APP_COLORS.textMuted, textAlign: "center" }}>{t("common.cancel", "Cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
