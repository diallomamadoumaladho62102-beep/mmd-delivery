import React, { useCallback, useMemo, useState } from "react";
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
  StatusBar,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  loadOwnSeller,
  loadSellerProducts,
  saveSellerProduct,
  toggleSellerProductActive,
  deleteSellerProduct,
} from "../../lib/sellerApi";
import { formatMoney, type SellerProductRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import {
  SellerBottomNav,
  SellerBrandHeader,
  SellerContentWrap,
  SellerFeedbackCard,
  SellerGlassCard,
  useSellerContentLayout,
} from "../../components/seller/SellerChrome";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
  const insets = useSafeAreaInsets();
  const { contentStyle } = useSellerContentLayout();
  const [loading, setLoading] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [products, setProducts] = useState<SellerProductRow[]>([]);
  const [query, setQuery] = useState("");
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
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ?? t("seller.products.loadFailed", "Unable to load products.")
      );
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, query]);

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
    if (!draft.title.trim() || !Number.isFinite(priceCents) || priceCents <= 0) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t("seller.products.invalidPrice", "Enter a valid price greater than zero.")
      );
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
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ?? t("seller.products.saveFailed", "Unable to save the product.")
      );
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
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ?? t("seller.products.updateFailed", "Unable to update the product.")
      );
    }
  };

  const removeProduct = (product: SellerProductRow) => {
    if (!sellerId) return;
    Alert.alert(
      t("seller.products.deleteTitle", "Delete product"),
      t(
        "seller.products.deleteBody",
        "Remove this product permanently? This cannot be undone.",
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.delete", "Delete"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteSellerProduct(sellerId, product.id);
                await refresh();
              } catch (e: unknown) {
                Alert.alert(
                  t("common.errorTitle", "Error"),
                  e instanceof Error
                    ? e.message
                    : t("seller.products.deleteFailed", "Unable to delete the product."),
                );
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <SellerBrandHeader
        subtitle={t("seller.products.title", "Products")}
        showBack
        fallbackRoute="SellerDashboard"
      />

      {loading ? (
        <SellerFeedbackCard
          loading
          title={t("common.loading", "Loading...")}
          message={t("seller.products.loading", "Fetching your products")}
        />
      ) : products.length === 0 ? (
        <SellerFeedbackCard
          icon="📦"
          title={t("seller.products.emptyTitle", "No Products Yet")}
          message={t(
            "seller.products.emptyBody",
            "Start building your catalog by adding your first product"
          )}
          actionLabel={t("seller.products.addFirst", "+ Add First Product")}
          onAction={openCreate}
        />
      ) : (
        <>
          <View style={styles.searchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("seller.products.search", "Search products...")}
              placeholderTextColor="rgba(255,255,255,0.5)"
              style={styles.search}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            {...MARKETPLACE_LIST_PERF}
            contentContainerStyle={[styles.list, contentStyle]}
            renderItem={({ item }) => {
              const outOfStock = item.stock_qty != null && item.stock_qty <= 0;
              return (
                <TouchableOpacity onPress={() => openEdit(item)} activeOpacity={0.85}>
                  <SellerGlassCard style={styles.productCard}>
                    <View style={styles.thumb}>
                      <Text style={{ fontSize: 22 }}>📦</Text>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={styles.productTitle}>{item.title}</Text>
                      <Text style={styles.productPrice}>
                        {formatMoney(item.price_cents, item.currency)}
                      </Text>
                      <View style={styles.stockRow}>
                        <View
                          style={[
                            styles.dot,
                            {
                              backgroundColor: outOfStock
                                ? "#EF4444"
                                : item.active
                                  ? MMD_TAXI_GREEN
                                  : "#F59E0B",
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.stockText,
                            outOfStock && { color: "rgba(239,68,68,0.85)" },
                          ]}
                        >
                          {outOfStock
                            ? t("seller.products.outOfStock", "Out of stock")
                            : item.stock_qty != null
                              ? t("seller.products.inStock", "{{n}} in stock", {
                                  n: item.stock_qty,
                                })
                              : item.active
                                ? t("seller.products.active", "Active")
                                : t("seller.products.inactive", "Inactive")}
                        </Text>
                      </View>
                      <View style={{ flexDirection: rowDirection(), gap: 12, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => openEdit(item)}>
                          <Text style={styles.link}>{t("common.edit", "Edit")}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => void toggleActive(item)}>
                          <Text
                            style={[
                              styles.link,
                              { color: item.active ? "#FCA5A5" : MMD_TAXI_GREEN },
                            ]}
                          >
                            {item.active
                              ? t("seller.products.deactivate", "Deactivate")
                              : t("seller.products.activate", "Activate")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeProduct(item)}>
                          <Text style={[styles.link, { color: "#FCA5A5" }]}>
                            {t("common.delete", "Delete")}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </SellerGlassCard>
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity
            style={styles.fab}
            onPress={openCreate}
            accessibilityRole="button"
            accessibilityLabel={t("seller.products.createTitle", "New product")}
          >
            <Text style={styles.fabPlus}>+</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalRoot}>
          <SellerContentWrap>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <ScrollView
              contentContainerStyle={{
                gap: 14,
                paddingBottom: Math.max(insets.bottom, 12),
              }}
            >
              <View style={styles.sheetTitleRow}>
                <View style={styles.sheetIcon}>
                  <Text>{draft.id ? "✏️" : "✨"}</Text>
                </View>
                <Text style={styles.sheetTitle}>
                  {draft.id
                    ? t("seller.products.editTitle", "Edit Product")
                    : t("seller.products.createTitle", "New Product")}
                </Text>
              </View>

              {(
                [
                  ["title", draft.title, (v: string) => setDraft((d) => ({ ...d, title: v })), "Product Title"],
                  ["description", draft.description, (v: string) => setDraft((d) => ({ ...d, description: v })), "Description"],
                  ["price", draft.price, (v: string) => setDraft((d) => ({ ...d, price: v })), "Price"],
                  ["promoPrice", draft.promoPrice, (v: string) => setDraft((d) => ({ ...d, promoPrice: v })), "Promo Price"],
                  ["currency", draft.currency, (v: string) => setDraft((d) => ({ ...d, currency: v })), "Currency"],
                  ["category", draft.category, (v: string) => setDraft((d) => ({ ...d, category: v })), "Category"],
                  ["stockQty", draft.stockQty, (v: string) => setDraft((d) => ({ ...d, stockQty: v })), "Stock Quantity"],
                  ["optionsText", draft.optionsText, (v: string) => setDraft((d) => ({ ...d, optionsText: v })), "Options (one per line)"],
                  ["variantsText", draft.variantsText, (v: string) => setDraft((d) => ({ ...d, variantsText: v })), "Variants (one per line)"],
                  ["imageUrl", draft.imageUrl, (v: string) => setDraft((d) => ({ ...d, imageUrl: v })), "Image URL"],
                ] as const
              ).map(([key, value, onChangeText, label]) => (
                <View key={key} style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={label}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    multiline={
                      key === "optionsText" ||
                      key === "variantsText" ||
                      key === "description"
                    }
                    style={[
                      styles.fieldInput,
                      (key === "optionsText" ||
                        key === "variantsText" ||
                        key === "description") && { minHeight: 80, textAlignVertical: "top" },
                    ]}
                  />
                </View>
              ))}

              <View style={styles.toggleRow}>
                <Text style={styles.fieldLabel}>{t("seller.products.active", "Active")}</Text>
                <Switch
                  value={draft.active}
                  onValueChange={(active) => setDraft((d) => ({ ...d, active }))}
                  trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>

              <TouchableOpacity
                onPress={() => void save()}
                disabled={saving}
                style={styles.saveBtn}
              >
                {saving ? (
                  <ActivityIndicator color={MMD_WHITE} />
                ) : (
                  <Text style={styles.saveLabel}>{t("common.save", "Save")}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setModalOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelLabel}>{t("common.cancel", "Cancel")}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
          </SellerContentWrap>
        </View>
      </Modal>

      <SellerBottomNav active="products" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  search: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 14,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  list: { padding: 16, gap: 14, paddingBottom: 100 },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderRadius: 22,
    padding: 20,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  productTitle: {
    color: MMD_WHITE,
    fontSize: 17,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  productPrice: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stockText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  link: { color: MMD_WHITE, fontFamily: MMD_FONT.semibold, fontWeight: "600" },
  chevron: { color: "rgba(255,255,255,0.5)", fontSize: 28, fontWeight: "300" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 110,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },
  fabPlus: {
    color: MMD_WHITE,
    fontSize: 32,
    fontWeight: "600",
    marginTop: -2,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: MMD_BLUE,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 24,
    maxHeight: "92%",
  },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: MMD_GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  fieldInput: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
    minHeight: 48,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    padding: 16,
  },
  saveBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 16,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  saveLabel: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});
