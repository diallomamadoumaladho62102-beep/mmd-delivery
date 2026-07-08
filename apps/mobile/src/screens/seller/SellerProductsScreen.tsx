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

type Props = { navigation: any };

type ProductDraft = {
  id?: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  category: string;
  imageUrl: string;
  active: boolean;
};

const EMPTY_DRAFT: ProductDraft = {
  title: "",
  description: "",
  price: "",
  currency: "USD",
  category: "general",
  imageUrl: "",
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
    setDraft({
      id: product.id,
      title: product.title,
      description: product.description,
      price: String((product.price_cents / 100).toFixed(2)),
      currency: product.currency,
      category: product.category,
      imageUrl: product.image_paths?.[0] ?? "",
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

    try {
      setSaving(true);
      await saveSellerProduct(sellerId, {
        id: draft.id,
        title: draft.title,
        description: draft.description,
        price_cents: priceCents,
        currency: draft.currency,
        category: draft.category,
        image_paths: draft.imageUrl.trim() ? [draft.imageUrl.trim()] : [],
        active: draft.active,
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.products.title", "Products")}
        fallbackRoute="SellerDashboard"
        variant="dark"
        rightSlot={
          <TouchableOpacity onPress={openCreate}>
            <Text style={{ color: "#A78BFA", fontSize: 24, fontWeight: "700" }}>+</Text>
          </TouchableOpacity>
        }
      />

      {loading ? (
        <ActivityIndicator color="#A78BFA" style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <Text style={{ color: "#94A3B8", textAlign: "center", marginTop: 24 }}>
              {t("seller.products.empty", "No products yet.")}
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: "#111827",
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>{item.title}</Text>
              <Text style={{ color: "#94A3B8", marginVertical: 4 }}>
                {formatMoney(item.price_cents, item.currency)} · {item.category}
              </Text>
              <Text style={{ color: "#CBD5E1" }} numberOfLines={2}>
                {item.description}
              </Text>
              <View style={{ flexDirection: rowDirection(), gap: 10, marginTop: 10 }}>
                <TouchableOpacity onPress={() => openEdit(item)}>
                  <Text style={{ color: "#A78BFA" }}>{t("common.edit", "Edit")}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void toggleActive(item)}>
                  <Text style={{ color: item.active ? "#FCA5A5" : "#86EFAC" }}>
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
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#111827", padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 10 }}>
            <Text style={{ color: "#F8FAFC", fontSize: 18, fontWeight: "700" }}>
              {draft.id
                ? t("seller.products.editTitle", "Edit product")
                : t("seller.products.createTitle", "New product")}
            </Text>
            {(
              [
                ["title", draft.title, (v: string) => setDraft((d) => ({ ...d, title: v }))],
                ["description", draft.description, (v: string) => setDraft((d) => ({ ...d, description: v }))],
                ["price", draft.price, (v: string) => setDraft((d) => ({ ...d, price: v }))],
                ["currency", draft.currency, (v: string) => setDraft((d) => ({ ...d, currency: v }))],
                ["category", draft.category, (v: string) => setDraft((d) => ({ ...d, category: v }))],
                ["imageUrl", draft.imageUrl, (v: string) => setDraft((d) => ({ ...d, imageUrl: v }))],
              ] as const
            ).map(([key, value, onChangeText]) => (
              <TextInput
                key={key}
                value={value}
                onChangeText={onChangeText}
                placeholder={key}
                placeholderTextColor="#64748B"
                style={{
                  backgroundColor: "#0F172A",
                  color: "#F8FAFC",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              />
            ))}
            <View style={{ flexDirection: rowDirection(), alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: "#CBD5E1" }}>{t("seller.products.active", "Active")}</Text>
              <Switch value={draft.active} onValueChange={(active) => setDraft((d) => ({ ...d, active }))} />
            </View>
            <TouchableOpacity
              onPress={() => void save()}
              disabled={saving}
              style={{
                backgroundColor: "#7C3AED",
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700" }}>{t("common.save", "Save")}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalOpen(false)}>
              <Text style={{ color: "#94A3B8", textAlign: "center" }}>{t("common.cancel", "Cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
