import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  Alert,
  FlatList,
  Image,
  Switch,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Category = {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string | null;
  position?: number | null;
  created_at?: string;
};

type Item = {
  id: string;
  restaurant_user_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  is_available: boolean;
  position: number | null;
  created_at?: string;
  updated_at?: string;
  category?: string | null;
};

type Props = { navigation: any };


const MAX_ITEM_NAME_LENGTH = 80;
const MAX_CATEGORY_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_PRICE_CENTS = 200000; // $2,000 safety limit for one menu item.
const SUPPORTED_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "GNF", "XOF", "SLE", "MRU"] as const;

function cleanText(value: string, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeCurrency(value: string) {
  const currency = String(value || "USD").trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency) ? currency : marketCurrencyFallback(currency);
}

function marketCurrencyFallback(currency: string) {
  const normalized = String(currency ?? "").trim().toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) return normalized;
  return "USD";
}

function isValidCategoryId(categoryId: string | null | undefined, categories: Category[]) {
  if (!categoryId) return true;
  return categories.some((category) => category.id === categoryId);
}

function moneyToCents(v: string) {
  const normalized = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return 0;

  return Math.round(n * 100);
}

function centsToMoneyString(cents: number | null | undefined) {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toFixed(2);
}

function getExtFromMimeOrUri(uri?: string | null, mime?: string | null) {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";

  const clean = (uri ?? "").split("?")[0];
  const ext = clean.split(".").pop()?.toLowerCase();
  if (!ext) return "jpg";
  if (ext === "jpeg") return "jpg";
  if (ext === "png" || ext === "webp" || ext === "jpg") return ext;
  return "jpg";
}

function contentTypeFromExt(ext: string) {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function storagePathFromPublicUrl(publicUrl: string, bucket: string) {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  const path = publicUrl.slice(idx + marker.length);
  return decodeURIComponent(path);
}

async function fileUriToUint8Array(fileUri: string): Promise<Uint8Array> {
  const response = await fetch(fileUri);
  if (!response.ok) {
    throw new Error(`Unable to read local file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export default function RestaurantMenuScreen({ navigation }: Props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [newCategoryName, setNewCategoryName] = useState("");

  const [newItem, setNewItem] = useState({
    category_id: "",
    name: "",
    description: "",
    price: "0.00",
    currency: "USD",
    image_url: "",
    is_available: true,
    position: "",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    category_id: "",
    name: "",
    description: "",
    price: "0.00",
    currency: "USD",
    image_url: "",
    is_available: true,
    position: "",
  });

  const [uploading, setUploading] = useState(false);
  const [savingAction, setSavingAction] = useState(false);

  const MENU_BUCKET = "restaurant-menu";
  const AVATAR_BUCKET = "avatars";

  const refreshAll = async (uid: string) => {
    try {
      const [catsRes, itemsRes] = await Promise.all([
        supabase
          .from("menu_categories")
          .select("*")
          .eq("restaurant_id", uid)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),

        supabase
          .from("restaurant_items")
          .select("*")
          .eq("restaurant_user_id", uid)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);

      if (catsRes.error) console.log("❌ load categories:", catsRes.error);
      if (itemsRes.error) console.log("❌ load items:", itemsRes.error);

      const cats = ((catsRes.data as any) ?? []) as Category[];
      const its = (((itemsRes.data as any) ?? []) as Item[]).map((it) => ({
        ...it,
        image_url: (it.image_url ?? "").toString().trim() || null,
      }));

      setCategories(cats);
      setItems(its);
    } catch (e) {
      console.log("❌ refreshAll exception:", e);
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;

        const uid = user?.id ?? null;

        if (!mounted) return;

        if (!uid) {
          setRestaurantUserId(null);
          navigation?.replace?.("RestaurantAuth");
          return;
        }

        const { data: roleProfile, error: roleError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (roleError) {
          console.log("❌ RestaurantMenuScreen role check:", roleError);
        }

        const role = String((roleProfile as any)?.role || "")
          .trim()
          .toLowerCase();

        if (role && role !== "restaurant") {
          setRestaurantUserId(null);

          navigation?.reset?.({
            index: 0,
            routes: [
              {
                name:
                  role === "driver"
                    ? "DriverTabs"
                    : role === "client"
                      ? "ClientHome"
                      : "RoleSelect",
              },
            ],
          });

          return;
        }

        const { data: restaurantProfile, error: profileError } = await supabase
          .from("restaurant_profiles")
          .select("user_id,status")
          .eq("user_id", uid)
          .maybeSingle();

        if (profileError) {
          console.log("❌ RestaurantMenuScreen profile check:", profileError);
        }

        if (!restaurantProfile) {
          setRestaurantUserId(null);
          navigation?.replace?.("RestaurantSetup");
          return;
        }

        setRestaurantUserId(uid);
        await refreshAll(uid);
      } catch (e) {
        console.log("❌ RestaurantMenuScreen boot exception:", e);
        if (mounted) {
          setRestaurantUserId(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigation]);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const key = it.category_id ?? "uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return map;
  }, [items]);

  const selectedCategoryName = (categoryId: string) => {
    if (!categoryId) {
      return t("restaurant.menu.categories.uncategorized", "Sans catégorie");
    }
    const c = categories.find((x) => x.id === categoryId);
    return c?.name ?? t("restaurant.menu.categories.uncategorized", "Sans catégorie");
  };

  const addCategory = async () => {
    if (!restaurantUserId || savingAction) return;

    const name = cleanText(newCategoryName, MAX_CATEGORY_NAME_LENGTH);
    if (!name) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.nameRequired", "Nom de catégorie obligatoire")
      );
    }

    const exists = categories.some(
      (category) => category.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (exists) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.duplicate", "Cette catégorie existe déjà.")
      );
    }

    try {
      setSavingAction(true);

      const { error } = await supabase.from("menu_categories").insert({
        restaurant_id: restaurantUserId,
        name,
        position: categories.length,
      });

      if (error) throw error;

      setNewCategoryName("");
      await refreshAll(restaurantUserId);
    } catch (error: any) {
      console.log("❌ add category:", error);
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.alerts.createFailed", "Création impossible.")
      );
    } finally {
      setSavingAction(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!restaurantUserId || savingAction) return;

    Alert.alert(
      t("restaurant.menu.categories.deleteTitle", "Supprimer la catégorie"),
      t(
        "restaurant.menu.categories.deleteConfirm",
        "Les produits de cette catégorie resteront dans Sans catégorie. Continuer ?"
      ),
      [
        { text: t("shared.common.cancel", "Annuler"), style: "cancel" },
        {
          text: t("restaurant.menu.actions.delete", "Supprimer"),
          style: "destructive",
          onPress: async () => {
            try {
              setSavingAction(true);

              const { error: updateItemsError } = await supabase
                .from("restaurant_items")
                .update({ category_id: null, updated_at: new Date().toISOString() })
                .eq("restaurant_user_id", restaurantUserId)
                .eq("category_id", id);

              if (updateItemsError) throw updateItemsError;

              const { error } = await supabase
                .from("menu_categories")
                .delete()
                .eq("id", id)
                .eq("restaurant_id", restaurantUserId);

              if (error) throw error;

              await refreshAll(restaurantUserId);
            } catch (error: any) {
              console.log("❌ delete category:", error);
              Alert.alert(
                t("restaurant.menu.alerts.errorTitle", "Erreur"),
                error?.message ?? t("restaurant.menu.alerts.deleteFailed", "Suppression impossible")
              );
            } finally {
              setSavingAction(false);
            }
          },
        },
      ]
    );
  };

  const pickAndUploadMenuImage = async (): Promise<string | null> => {
    try {
      if (!restaurantUserId) return null;

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t("restaurant.menu.alerts.permissionTitle", "Permission requise"),
          t("restaurant.menu.alerts.permissionPhotosBody", "Autorise l'accès aux photos.")
        );
        return null;
      }

      const mediaTypes: any =
        (ImagePicker as any)?.MediaType?.Images ??
        (ImagePicker as any)?.MediaTypeOptions?.Images ??
        "Images";

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled) return null;

      const asset = result.assets?.[0];
      const uri = asset?.uri;
      if (!uri) {
        Alert.alert(
          t("restaurant.menu.alerts.errorTitle", "Erreur"),
          t("restaurant.menu.alerts.invalidImageUri", "Image invalide (uri manquante).")
        );
        return null;
      }

      const mime = (asset as any)?.mimeType ?? null;
      const ext = getExtFromMimeOrUri(uri, mime);

      setUploading(true);

      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1280 } }],
        {
          compress: 0.75,
          format:
            ext === "png"
              ? ImageManipulator.SaveFormat.PNG
              : ImageManipulator.SaveFormat.JPEG,
        }
      );

      const finalExt = ext === "png" ? "png" : "jpg";
      const bytes = await fileUriToUint8Array(manipulated.uri);
      const path = `restaurants/${restaurantUserId}/menu/${Date.now()}_${Math.random().toString(36).slice(2)}.${finalExt}`;

      const { error: upErr } = await supabase.storage.from(MENU_BUCKET).upload(path, bytes, {
        contentType: contentTypeFromExt(finalExt),
        upsert: true,
      });

      if (upErr) {
        console.log("❌ menu image upload error", upErr);

        Alert.alert(
          t("restaurant.menu.alerts.errorTitle", "Erreur"),
          `${t(
            "restaurant.menu.alerts.imageNotUploaded",
            "Image non envoyée. Vérifie les policies Storage du bucket:"
          )} '${MENU_BUCKET}'.`
        );

        return null;
      }

      const pub = supabase.storage.from(MENU_BUCKET).getPublicUrl(path);
      const publicUrl = pub?.data?.publicUrl || null;

      return publicUrl;
    } catch (e: any) {
      console.log("❌ pickAndUploadMenuImage error", e);
      Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        e?.message ?? t("restaurant.menu.alerts.uploadFailed", "Upload impossible")
      );
      return null;
    } finally {
      setUploading(false);
    }
  };

  const addItem = async () => {
    if (!restaurantUserId) return;

    const name = cleanText(newItem.name, MAX_ITEM_NAME_LENGTH);
    if (!name) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.nameRequired", "Nom obligatoire")
      );
    }

    const priceCents = moneyToCents(newItem.price);
    if (!priceCents || priceCents <= 0 || priceCents > MAX_PRICE_CENTS) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.invalidPrice", "Prix invalide")
      );
    }

    const selectedCategoryId = newItem.category_id || null;

    if (!isValidCategoryId(selectedCategoryId, categories)) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.invalid", "Catégorie invalide.")
      );
    }

    const position =
      newItem.position.trim() !== "" ? Number(newItem.position) : items.length + 1;

    const payload: Partial<Item> & any = {
      restaurant_user_id: restaurantUserId,
      category_id: selectedCategoryId,
      name,
      description: cleanText(newItem.description, MAX_DESCRIPTION_LENGTH) || null,
      price_cents: priceCents,
      currency: normalizeCurrency(newItem.currency),
      image_url: newItem.image_url.trim() ? newItem.image_url.trim() : null,
      is_available: Boolean(newItem.is_available),
      position: Number.isFinite(position) ? position : items.length + 1,
    };

    try {
      setSavingAction(true);

      const { error } = await supabase.from("restaurant_items").insert(payload);

      if (error) throw error;

      setNewItem({
        category_id: "",
        name: "",
        description: "",
        price: "0.00",
        currency: "USD",
        image_url: "",
        is_available: true,
        position: "",
      });

      await refreshAll(restaurantUserId);
    } catch (error: any) {
      console.log("❌ add item:", error);
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.alerts.createFailed", "Création impossible.")
      );
    } finally {
      setSavingAction(false);
    }
  };

  const toggleAvailable = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("restaurant_items")
      .update({ is_available: value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_user_id", restaurantUserId);

    if (error) {
      console.log("❌ toggle available:", error);
      return Alert.alert(t("restaurant.menu.alerts.errorTitle", "Erreur"), error.message);
    }
    if (restaurantUserId) await refreshAll(restaurantUserId);
  };

  const deleteItem = async (id: string) => {
    if (!restaurantUserId || savingAction) return;

    Alert.alert(
      t("restaurant.menu.items.deleteTitle", "Supprimer le produit"),
      t("restaurant.menu.items.deleteConfirm", "Confirmer la suppression de ce produit ?"),
      [
        { text: t("shared.common.cancel", "Annuler"), style: "cancel" },
        {
          text: t("restaurant.menu.actions.delete", "Supprimer"),
          style: "destructive",
          onPress: async () => {
            try {
              setSavingAction(true);

              const it = items.find((x) => x.id === id) ?? null;

              if (it?.image_url) {
                const url = it.image_url.trim();

                const menuPath = storagePathFromPublicUrl(url, MENU_BUCKET);
                const avatarPath = storagePathFromPublicUrl(url, AVATAR_BUCKET);

                if (menuPath) {
                  const { error: rmErr } = await supabase.storage.from(MENU_BUCKET).remove([menuPath]);
                  if (rmErr) console.log("⚠️ remove storage image error (menu):", rmErr);
                } else if (avatarPath) {
                  const { error: rmErr } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath]);
                  if (rmErr) console.log("⚠️ remove storage image error (avatars):", rmErr);
                }
              }

              const { error } = await supabase
                .from("restaurant_items")
                .delete()
                .eq("id", id)
                .eq("restaurant_user_id", restaurantUserId);

              if (error) throw error;

              await refreshAll(restaurantUserId);
            } catch (error: any) {
              console.log("❌ deleteItem exception:", error);
              Alert.alert(
                t("restaurant.menu.alerts.errorTitle", "Erreur"),
                error?.message ?? t("restaurant.menu.alerts.deleteFailed", "Suppression impossible")
              );
            } finally {
              setSavingAction(false);
            }
          },
        },
      ]
    );
  };

  const openEdit = (it: Item) => {
    setEditItemId(it.id);
    setEditForm({
      category_id: it.category_id ?? "",
      name: it.name ?? "",
      description: it.description ?? "",
      price: centsToMoneyString(it.price_cents),
      currency: it.currency ?? "USD",
      image_url: it.image_url ?? "",
      is_available: Boolean(it.is_available),
      position: it.position != null ? String(it.position) : "",
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditItemId(null);
    setEditSaving(false);
  };

  const saveEdit = async () => {
    if (!restaurantUserId) return;
    if (!editItemId) return;

    const name = cleanText(editForm.name, MAX_ITEM_NAME_LENGTH);
    if (!name) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.nameRequired", "Nom obligatoire")
      );
    }

    const priceCents = moneyToCents(editForm.price);
    if (!priceCents || priceCents <= 0 || priceCents > MAX_PRICE_CENTS) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.invalidPrice", "Prix invalide")
      );
    }

    const selectedCategoryId = editForm.category_id || null;

    if (!isValidCategoryId(selectedCategoryId, categories)) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.invalid", "Catégorie invalide.")
      );
    }

    const position = editForm.position.trim() !== "" ? Number(editForm.position) : null;

    const payload: any = {
      category_id: selectedCategoryId,
      name,
      description: cleanText(editForm.description, MAX_DESCRIPTION_LENGTH) || null,
      price_cents: priceCents,
      currency: normalizeCurrency(editForm.currency),
      image_url: editForm.image_url.trim() ? editForm.image_url.trim() : null,
      is_available: Boolean(editForm.is_available),
      position: Number.isFinite(position as any) ? position : null,
      updated_at: new Date().toISOString(),
    };

    try {
      setEditSaving(true);

      const { error } = await supabase
        .from("restaurant_items")
        .update(payload)
        .eq("id", editItemId)
        .eq("restaurant_user_id", restaurantUserId);

      if (error) {
        console.log("❌ edit item:", error);
        return Alert.alert(t("restaurant.menu.alerts.errorTitle", "Erreur"), error.message);
      }

      await refreshAll(restaurantUserId);
      closeEdit();
    } catch (e: any) {
      Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        e?.message ?? t("restaurant.menu.alerts.updateFailed", "Update impossible.")
      );
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("restaurant.menu.header.title", "Menu / Produits")}
          variant="light"
          fallbackRoute="RestaurantCommandCenter"
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text>{t("restaurant.menu.loading", "Chargement…")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!restaurantUserId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("restaurant.menu.header.title", "Menu / Produits")}
          variant="light"
          fallbackRoute="RestaurantCommandCenter"
        />
        <View style={{ flex: 1, padding: 16 }}>
          <Text style={{ fontSize: 16 }}>
            {t("restaurant.menu.errors.accountRequired", "❌ Compte restaurant requis")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const Section = ({ title, list }: { title: string; list: Item[] }) => {
    if (!list.length) return null;

    return (
      <View style={{ marginTop: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 8 }}>{title}</Text>

        <FlatList
          data={list}
          keyExtractor={(it) => it.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {item.image_url ? (
                  <Image
                    source={{ uri: item.image_url }}
                    style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: "#eee" }}
                    resizeMode="cover"
                    onError={(e) =>
                      console.log("⚠️ image render error:", item.image_url, e.nativeEvent)
                    }
                  />
                ) : (
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 10,
                      backgroundColor: "#eee",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 10, color: "#666" }}>
                      {t("restaurant.menu.items.noPhoto", "No photo")}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>{item.name}</Text>
                  {!!item.description && (
                    <Text style={{ marginTop: 2, color: "#444" }}>{item.description}</Text>
                  )}

                  <Text style={{ marginTop: 6 }}>
                    {t("restaurant.menu.items.pricePrefix", "💰")} $
                    {(item.price_cents / 100).toFixed(2)} {item.currency}
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginTop: 8,
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text>
                        {item.is_available
                          ? t("restaurant.menu.items.available", "✅ Disponible")
                          : t("restaurant.menu.items.unavailable", "⛔ Indispo")}
                      </Text>
                      <Switch
                        value={Boolean(item.is_available)}
                        disabled={savingAction}
                        onValueChange={(v) => toggleAvailable(item.id, v)}
                      />
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <TouchableOpacity onPress={() => openEdit(item)}>
                        <Text style={{ color: "#2563EB", fontWeight: "800" }}>
                          {t("restaurant.menu.actions.edit", "Modifier")}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => deleteItem(item.id)}>
                        <Text style={{ color: "#dc2626", fontWeight: "700" }}>
                          {t("restaurant.menu.actions.delete", "Supprimer")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("restaurant.menu.header.title", "Menu / Produits")}
        variant="light"
        fallbackRoute="RestaurantCommandCenter"
        rightSlot={
          <TouchableOpacity
            onPress={() => navigation?.navigate("RestaurantEarnings")}
            style={{
              backgroundColor: "#22C55E",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "white", fontWeight: "800" }}>
              {t("restaurant.menu.header.earnings", "Earnings")}
            </Text>
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 50 }}>

      <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 10 }}>
          {t("restaurant.menu.categories.title", "Catégories")}
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={newCategoryName}
            onChangeText={setNewCategoryName}
            placeholder={t(
              "restaurant.menu.categories.placeholder",
              "Ex: Pizzas, Boissons, Snacks..."
            )}
            style={{ flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 }}
          />
          <Button title={t("restaurant.menu.actions.add", "Ajouter")} onPress={addCategory} disabled={savingAction} />
        </View>

        {categories.map((c) => (
          <View
            key={c.id}
            style={{
              marginTop: 10,
              borderWidth: 1,
              borderRadius: 10,
              padding: 10,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "700" }}>{c.name}</Text>
            <TouchableOpacity onPress={() => deleteCategory(c.id)}>
              <Text style={{ color: "#dc2626", fontWeight: "700" }}>
                {t("restaurant.menu.actions.delete", "Supprimer")}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        {categories.length === 0 && (
          <Text style={{ marginTop: 10, color: "#666" }}>
            {t("restaurant.menu.categories.empty", "Aucune catégorie pour l’instant.")}
          </Text>
        )}
      </View>

      <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 10 }}>
          {t("restaurant.menu.items.addTitle", "Ajouter un produit")}
        </Text>

        <Text style={{ marginTop: 6 }}>
          {t("restaurant.menu.items.categoryLabel", "Catégorie")}
        </Text>
        <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <TouchableOpacity
            onPress={() => setNewItem((s) => ({ ...s, category_id: "" }))}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              backgroundColor: newItem.category_id === "" ? "#111827" : "transparent",
            }}
          >
            <Text
              style={{
                fontWeight: "800",
                color: newItem.category_id === "" ? "white" : "#111827",
              }}
            >
              {t("restaurant.menu.categories.uncategorized", "Sans catégorie")}
            </Text>
          </TouchableOpacity>

          {categories.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => setNewItem((s) => ({ ...s, category_id: c.id }))}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                backgroundColor: newItem.category_id === c.id ? "#111827" : "transparent",
              }}
            >
              <Text
                style={{
                  fontWeight: "800",
                  color: newItem.category_id === c.id ? "white" : "#111827",
                }}
              >
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ marginTop: 8, color: "#444" }}>
          {t("restaurant.menu.items.selectionLabel", "Sélection :")}{" "}
          <Text style={{ fontWeight: "800" }}>{selectedCategoryName(newItem.category_id)}</Text>
        </Text>

        <Text style={{ marginTop: 6 }}>{t("restaurant.menu.items.nameLabel", "Nom")}</Text>
        <TextInput
          value={newItem.name}
          onChangeText={(v) => setNewItem((s) => ({ ...s, name: v }))}
          style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
        />

        <Text style={{ marginTop: 6 }}>
          {t("restaurant.menu.items.descriptionLabel", "Description")}
        </Text>
        <TextInput
          value={newItem.description}
          onChangeText={(v) => setNewItem((s) => ({ ...s, description: v }))}
          style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
        />

        <Text style={{ marginTop: 6 }}>
          {t("restaurant.menu.items.priceLabel", "Prix (ex: 12.99)")}
        </Text>
        <TextInput
          value={newItem.price}
          onChangeText={(v) => setNewItem((s) => ({ ...s, price: v }))}
          keyboardType="decimal-pad"
          style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
        />

        <Text style={{ marginTop: 6 }}>{t("restaurant.menu.items.currencyLabel", "Devise")}</Text>
        <TextInput
          value={newItem.currency}
          onChangeText={(v) => setNewItem((s) => ({ ...s, currency: v }))}
          style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
        />

        <Text style={{ marginTop: 6 }}>{t("restaurant.menu.items.imageLabel", "Image")}</Text>
        <TouchableOpacity
          disabled={uploading}
          onPress={async () => {
            const url = await pickAndUploadMenuImage();
            if (url) setNewItem((s) => ({ ...s, image_url: url }));
          }}
          style={{
            marginTop: 8,
            borderWidth: 1,
            borderRadius: 10,
            padding: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? <ActivityIndicator /> : null}
          <Text style={{ fontWeight: "700" }}>
            {newItem.image_url
              ? t("restaurant.menu.items.changeImage", "Changer l’image")
              : t("restaurant.menu.items.chooseImage", "Choisir une image")}
          </Text>
        </TouchableOpacity>

        {newItem.image_url ? (
          <Image
            source={{ uri: newItem.image_url.trim() }}
            style={{ width: 120, height: 120, borderRadius: 12, marginTop: 10 }}
            resizeMode="cover"
            onError={(e) =>
              console.log("⚠️ preview image error (newItem):", newItem.image_url, e.nativeEvent)
            }
          />
        ) : null}

        <Text style={{ marginTop: 6 }}>
          {t("restaurant.menu.items.positionLabel", "Position (optionnel)")}
        </Text>
        <TextInput
          value={newItem.position}
          onChangeText={(v) => setNewItem((s) => ({ ...s, position: v }))}
          keyboardType="number-pad"
          placeholder={t("restaurant.menu.items.positionPlaceholder", "ex: 1")}
          style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          <Text>{t("restaurant.menu.items.availableLabel", "Disponible")}</Text>
          <Switch
            value={Boolean(newItem.is_available)}
            disabled={savingAction}
            onValueChange={(v) => setNewItem((s) => ({ ...s, is_available: v }))}
          />
        </View>

        <View style={{ marginTop: 10 }}>
          <Button
            title={savingAction ? t("shared.common.saving", "Enregistrement…") : t("restaurant.menu.items.addButton", "Ajouter le produit")}
            onPress={addItem}
            disabled={savingAction || uploading}
          />
        </View>
      </View>

      <View style={{ borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 }}>
        <Text style={{ fontSize: 16, fontWeight: "700" }}>
          {t("restaurant.menu.list.title", "Ton menu")}
        </Text>

        <Section
          title={t("restaurant.menu.categories.uncategorized", "Sans catégorie")}
          list={itemsByCategory.get("uncategorized") ?? []}
        />

        {categories.map((c) => (
          <Section key={c.id} title={c.name} list={itemsByCategory.get(c.id) ?? []} />
        ))}
      </View>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={closeEdit}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View style={{ backgroundColor: "white", borderRadius: 14, padding: 14 }}>
            <Text style={{ fontSize: 18, fontWeight: "800" }}>
              {t("restaurant.menu.edit.title", "Modifier le produit")}
            </Text>

            <Text style={{ marginTop: 10 }}>
              {t("restaurant.menu.items.categoryLabel", "Catégorie")}
            </Text>
            <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <TouchableOpacity
                onPress={() => setEditForm((s) => ({ ...s, category_id: "" }))}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  backgroundColor: editForm.category_id === "" ? "#111827" : "transparent",
                }}
              >
                <Text
                  style={{
                    fontWeight: "800",
                    color: editForm.category_id === "" ? "white" : "#111827",
                  }}
                >
                  {t("restaurant.menu.categories.uncategorized", "Sans catégorie")}
                </Text>
              </TouchableOpacity>

              {categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setEditForm((s) => ({ ...s, category_id: c.id }))}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    backgroundColor: editForm.category_id === c.id ? "#111827" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "800",
                      color: editForm.category_id === c.id ? "white" : "#111827",
                    }}
                  >
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ marginTop: 8, color: "#444" }}>
              {t("restaurant.menu.items.selectionLabel", "Sélection :")}{" "}
              <Text style={{ fontWeight: "800" }}>{selectedCategoryName(editForm.category_id)}</Text>
            </Text>

            <Text style={{ marginTop: 10 }}>{t("restaurant.menu.items.nameLabel", "Nom")}</Text>
            <TextInput
              value={editForm.name}
              onChangeText={(v) => setEditForm((s) => ({ ...s, name: v }))}
              style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
            />

            <Text style={{ marginTop: 10 }}>
              {t("restaurant.menu.items.descriptionLabel", "Description")}
            </Text>
            <TextInput
              value={editForm.description}
              onChangeText={(v) => setEditForm((s) => ({ ...s, description: v }))}
              style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
            />

            <Text style={{ marginTop: 10 }}>
              {t("restaurant.menu.items.priceLabel", "Prix (ex: 12.99)")}
            </Text>
            <TextInput
              value={editForm.price}
              onChangeText={(v) => setEditForm((s) => ({ ...s, price: v }))}
              keyboardType="decimal-pad"
              style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
            />

            <Text style={{ marginTop: 10 }}>
              {t("restaurant.menu.items.currencyLabel", "Devise")}
            </Text>
            <TextInput
              value={editForm.currency}
              onChangeText={(v) => setEditForm((s) => ({ ...s, currency: v }))}
              style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
            />

            <Text style={{ marginTop: 10 }}>{t("restaurant.menu.items.imageLabel", "Image")}</Text>
            <TouchableOpacity
              disabled={uploading}
              onPress={async () => {
                const url = await pickAndUploadMenuImage();
                if (url) setEditForm((s) => ({ ...s, image_url: url }));
              }}
              style={{
                marginTop: 8,
                borderWidth: 1,
                borderRadius: 10,
                padding: 12,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 10,
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? <ActivityIndicator /> : null}
              <Text style={{ fontWeight: "700" }}>
                {editForm.image_url
                  ? t("restaurant.menu.items.changeImage", "Changer l’image")
                  : t("restaurant.menu.items.chooseImage", "Choisir une image")}
              </Text>
            </TouchableOpacity>

            {editForm.image_url ? (
              <Image
                source={{ uri: editForm.image_url.trim() }}
                style={{ width: 120, height: 120, borderRadius: 12, marginTop: 10 }}
                resizeMode="cover"
                onError={(e) =>
                  console.log("⚠️ preview image error (edit):", editForm.image_url, e.nativeEvent)
                }
              />
            ) : null}

            <Text style={{ marginTop: 10 }}>
              {t("restaurant.menu.items.positionLabel", "Position (optionnel)")}
            </Text>
            <TextInput
              value={editForm.position}
              onChangeText={(v) => setEditForm((s) => ({ ...s, position: v }))}
              keyboardType="number-pad"
              placeholder={t("restaurant.menu.items.positionPlaceholder", "ex: 1")}
              style={{ borderWidth: 1, borderRadius: 10, padding: 10 }}
            />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 12,
              }}
            >
              <Text>{t("restaurant.menu.items.availableLabel", "Disponible")}</Text>
              <Switch
                value={Boolean(editForm.is_available)}
                disabled={editSaving || uploading}
                onValueChange={(v) => setEditForm((s) => ({ ...s, is_available: v }))}
              />
            </View>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <TouchableOpacity onPress={closeEdit} disabled={editSaving || uploading}>
                <Text style={{ color: "#111827", fontWeight: "800", padding: 8 }}>
                  {t("shared.common.cancel", "Annuler")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={saveEdit} disabled={editSaving || uploading}>
                <View
                  style={{
                    backgroundColor: "#2563EB",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    opacity: editSaving || uploading ? 0.7 : 1,
                  }}
                >
                  {editSaving ? <ActivityIndicator /> : null}
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {t("shared.common.save", "Enregistrer")}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}