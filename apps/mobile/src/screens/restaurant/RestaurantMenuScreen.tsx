import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Alert,
  Image,
  Switch,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../../components/restaurant/RestaurantBrandLoadingState";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const GLASS_BORDER = "rgba(255,255,255,0.2)";

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
  stock_qty?: number | null;
  options_json?: unknown;
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

function moneyToCentsAllowZero(v: string) {
  const normalized = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;

  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;

  return Math.round(n * 100);
}

function parseStockQty(raw: string): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function serializeOptionsText(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "";
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const row = entry as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const cents = Number(row.price_cents ?? 0);
      if (!name || !Number.isFinite(cents)) return "";
      return `${name}:${(cents / 100).toFixed(2)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function parseOptionsText(raw: string): Array<{ id: string; name: string; price_cents: number }> {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [namePart, pricePart] = line.split(":").map((part) => part.trim());
    const name = cleanText(namePart || "", 80);
    const priceCents = moneyToCentsAllowZero(pricePart || "0");
    if (!name || Number.isNaN(priceCents)) {
      throw new Error(`Option invalide: ${line}`);
    }
    return {
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      price_cents: priceCents,
    };
  });
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
    stock_qty: "",
    options_text: "",
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
    stock_qty: "",
    options_text: "",
    position: "",
  });

  const [uploading, setUploading] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);

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

      if (catsRes.error) console.log("âŒ load categories:", catsRes.error);
      if (itemsRes.error) console.log("âŒ load items:", itemsRes.error);

      const cats = ((catsRes.data as any) ?? []) as Category[];
      const its = (((itemsRes.data as any) ?? []) as Item[]).map((it) => ({
        ...it,
        image_url: (it.image_url ?? "").toString().trim() || null,
      }));

      setCategories(cats);
      setItems(its);
      setSelectedCategoryId((prev) => {
        if (prev && cats.some((c) => c.id === prev)) return prev;
        return cats[0]?.id ?? null;
      });
    } catch (e) {
      console.log("âŒ refreshAll exception:", e);
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
          console.log("âŒ RestaurantMenuScreen role check:", roleError);
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
          console.log("âŒ RestaurantMenuScreen profile check:", profileError);
        }

        if (!restaurantProfile) {
          setRestaurantUserId(null);
          navigation?.replace?.("RestaurantSetup");
          return;
        }

        setRestaurantUserId(uid);
        await refreshAll(uid);
      } catch (e) {
        console.log("âŒ RestaurantMenuScreen boot exception:", e);
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
      return t("restaurant.menu.categories.uncategorized", "Uncategorized");
    }
    const c = categories.find((x) => x.id === categoryId);
    return c?.name ?? t("restaurant.menu.categories.uncategorized", "Uncategorized");
  };

  const addCategory = async () => {
    if (!restaurantUserId || savingAction) return;

    const name = cleanText(newCategoryName, MAX_CATEGORY_NAME_LENGTH);
    if (!name) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.nameRequired", "Category name required")
      );
    }

    const exists = categories.some(
      (category) => category.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (exists) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.duplicate", "This category already exists.")
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
      console.log("âŒ add category:", error);
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.alerts.createFailed", "Create failed.")
      );
    } finally {
      setSavingAction(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!restaurantUserId || savingAction) return;

    Alert.alert(
      t("restaurant.menu.categories.deleteTitle", "Delete category"),
      t(
        "restaurant.menu.categories.deleteConfirm",
        "Items in this category will become uncategorized. Continue?"
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
              console.log("âŒ delete category:", error);
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
          t("restaurant.menu.alerts.permissionPhotosBody", "Allow photo access.")
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
        console.log("âŒ menu image upload error", upErr);

        Alert.alert(
          t("restaurant.menu.alerts.errorTitle", "Erreur"),
          `${t(
            "restaurant.menu.alerts.imageNotUploaded",
            "Image not uploaded. Check Storage policies for bucket:"
          )} '${MENU_BUCKET}'.`
        );

        return null;
      }

      const pub = supabase.storage.from(MENU_BUCKET).getPublicUrl(path);
      const publicUrl = pub?.data?.publicUrl || null;

      return publicUrl;
    } catch (e: any) {
      console.log("âŒ pickAndUploadMenuImage error", e);
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

    const selectedCatId = newItem.category_id || selectedCategoryId || null;

    if (!isValidCategoryId(selectedCatId, categories)) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.categories.invalid", "Categorie invalide.")
      );
    }

    const position =
      newItem.position.trim() !== "" ? Number(newItem.position) : items.length + 1;

    const stockQty = parseStockQty(newItem.stock_qty);
    if (Number.isNaN(stockQty as any)) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.invalidStock", "Stock invalide (nombre entier ou vide).")
      );
    }

    let optionsJson: Array<{ id: string; name: string; price_cents: number }> = [];
    try {
      optionsJson = parseOptionsText(newItem.options_text);
    } catch (error: any) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.items.invalidOptions", "Options invalides.")
      );
    }

    const payload: Partial<Item> & any = {
      restaurant_user_id: restaurantUserId,
      category_id: selectedCatId,
      name,
      description: cleanText(newItem.description, MAX_DESCRIPTION_LENGTH) || null,
      price_cents: priceCents,
      currency: normalizeCurrency(newItem.currency),
      image_url: newItem.image_url.trim() ? newItem.image_url.trim() : null,
      is_available: Boolean(newItem.is_available),
      stock_qty: stockQty,
      options_json: optionsJson,
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
        stock_qty: "",
        options_text: "",
        position: "",
      });

      await refreshAll(restaurantUserId);
    } catch (error: any) {
      console.log("âŒ add item:", error);
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.alerts.createFailed", "Create failed.")
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
      console.log("âŒ toggle available:", error);
      return Alert.alert(t("restaurant.menu.alerts.errorTitle", "Erreur"), toUserFacingError(error, "Action impossible pour le moment."));
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
                  if (rmErr) console.log("âš ï¸ remove storage image error (menu):", rmErr);
                } else if (avatarPath) {
                  const { error: rmErr } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath]);
                  if (rmErr) console.log("âš ï¸ remove storage image error (avatars):", rmErr);
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
              console.log("âŒ deleteItem exception:", error);
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
      stock_qty: it.stock_qty != null ? String(it.stock_qty) : "",
      options_text: serializeOptionsText(it.options_json),
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
        t("restaurant.menu.categories.invalid", "Invalid category.")
      );
    }

    const position = editForm.position.trim() !== "" ? Number(editForm.position) : null;

    const stockQty = parseStockQty(editForm.stock_qty);
    if (Number.isNaN(stockQty as any)) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        t("restaurant.menu.items.invalidStock", "Stock invalide (nombre entier ou vide).")
      );
    }

    let optionsJson: Array<{ id: string; name: string; price_cents: number }> = [];
    try {
      optionsJson = parseOptionsText(editForm.options_text);
    } catch (error: any) {
      return Alert.alert(
        t("restaurant.menu.alerts.errorTitle", "Erreur"),
        error?.message ?? t("restaurant.menu.items.invalidOptions", "Options invalides.")
      );
    }

    const payload: any = {
      category_id: selectedCategoryId,
      name,
      description: cleanText(editForm.description, MAX_DESCRIPTION_LENGTH) || null,
      price_cents: priceCents,
      currency: normalizeCurrency(editForm.currency),
      image_url: editForm.image_url.trim() ? editForm.image_url.trim() : null,
      is_available: Boolean(editForm.is_available),
      stock_qty: stockQty,
      options_json: optionsJson,
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
        console.log("âŒ edit item:", error);
        return Alert.alert(t("restaurant.menu.alerts.errorTitle", "Erreur"), toUserFacingError(error, "Action impossible pour le moment."));
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
  const activeCategoryId = selectedCategoryId ?? categories[0]?.id ?? null;
  const visibleItems = useMemo(() => {
    if (!activeCategoryId) return [];
    return items.filter((it) => it.category_id === activeCategoryId);
  }, [activeCategoryId, items]);

  const formatPrice = (it: Item) =>
    `$${(Number(it.price_cents || 0) / 100).toFixed(2)}`;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader title="Menu" variant="mmd" fallbackRoute="RestaurantCommandCenter" />
        <RestaurantBrandLoadingState
          title="Loading Menu..."
          subtitle="Fetching your menu items"
          glass
        />
      </SafeAreaView>
    );
  }

  if (!restaurantUserId) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader title="Menu" variant="mmd" fallbackRoute="RestaurantCommandCenter" />
        <View style={styles.emptyPad}>
          <Text style={styles.emptyTitle}>
            {t("restaurant.menu.errors.accountRequired", "Restaurant account required")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const emptyCategories = categories.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title="Menu"
        variant="mmd"
        fallbackRoute="RestaurantCommandCenter"
        rightSlot={
          emptyCategories ? null : (
            <TouchableOpacity
              onPress={() => {
                setNewItem((s) => ({
                  ...s,
                  category_id: selectedCategoryId ?? categories[0]?.id ?? "",
                }));
                setAddItemOpen(true);
              }}
              style={styles.headerAction}
              accessibilityRole="button"
            >
              <Text style={styles.headerActionText}>+ Item</Text>
            </TouchableOpacity>
          )
        }
      />

      {emptyCategories ? (
        <View style={styles.emptyContent}>
          <TouchableOpacity
            style={styles.addCategoryBtn}
            onPress={() => setAddCategoryOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.addCategoryBtnText}>+ Add Category</Text>
          </TouchableOpacity>
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Text style={styles.emptyIcon}>ðŸ“‚</Text>
            </View>
            <View style={styles.emptyTextStack}>
              <Text style={styles.emptyTitle}>No Categories</Text>
              <Text style={styles.emptySubtitle}>
                No categories yet. Add one to get started.
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.menuContent}
          showsVerticalScrollIndicator={false}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
          >
            {categories.map((c) => {
              const active = c.id === activeCategoryId;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setSelectedCategoryId(c.id)}
                  onLongPress={() => deleteCategory(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.tab}
              onPress={() => setAddCategoryOpen(true)}
              accessibilityRole="button"
            >
              <Text style={styles.tabText}>+</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.itemsCol}>
            {visibleItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyTextStack}>
                  <Text style={styles.emptyTitle}>No items</Text>
                  <Text style={styles.emptySubtitle}>
                    Add a product to this category.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.addCategoryBtn, { marginTop: 8 }]}
                  onPress={() => {
                    setNewItem((s) => ({
                      ...s,
                      category_id: activeCategoryId ?? "",
                    }));
                    setAddItemOpen(true);
                  }}
                >
                  <Text style={styles.addCategoryBtnText}>+ Add Item</Text>
                </TouchableOpacity>
              </View>
            ) : (
              visibleItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.itemCard}
                  onPress={() => openEdit(item)}
                  activeOpacity={0.85}
                >
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={styles.itemThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.itemThumbPlaceholder}>
                      <Text style={styles.itemThumbEmoji}>ðŸ½ï¸</Text>
                    </View>
                  )}
                  <View style={styles.itemMeta}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemPrice}>{formatPrice(item)}</Text>
                    <View style={styles.statusRow}>
                      <TouchableOpacity
                        style={[
                          styles.badge,
                          item.is_available ? styles.badgeOn : styles.badgeOff,
                        ]}
                        onPress={() => toggleAvailable(item.id, !item.is_available)}
                        disabled={savingAction}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            item.is_available ? styles.badgeTextOn : styles.badgeTextOff,
                          ]}
                        >
                          {item.is_available ? "Available" : "Unavailable"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <Modal
        visible={addCategoryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddCategoryOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Category</Text>
            <TextInput
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Category name"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAddCategoryOpen(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSave}
                onPress={async () => {
                  await addCategory();
                  setAddCategoryOpen(false);
                }}
                disabled={savingAction}
              >
                <Text style={styles.modalSaveText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={addItemOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddItemOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Item</Text>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={newItem.name}
                onChangeText={(v) => setNewItem((s) => ({ ...s, name: v }))}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <Text style={styles.fieldLabel}>Price</Text>
              <TextInput
                value={newItem.price}
                onChangeText={(v) => setNewItem((s) => ({ ...s, price: v }))}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                value={newItem.description}
                onChangeText={(v) => setNewItem((s) => ({ ...s, description: v }))}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <View style={styles.switchRow}>
                <Text style={styles.fieldLabelInline}>Available</Text>
                <Switch
                  value={Boolean(newItem.is_available)}
                  onValueChange={(v) => setNewItem((s) => ({ ...s, is_available: v }))}
                  trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>
              <TouchableOpacity
                disabled={uploading}
                onPress={async () => {
                  const url = await pickAndUploadMenuImage();
                  if (url) setNewItem((s) => ({ ...s, image_url: url }));
                }}
                style={styles.secondaryBtn}
              >
                {uploading ? <ActivityIndicator color={MMD_WHITE} /> : null}
                <Text style={styles.secondaryBtnText}>
                  {newItem.image_url ? "Change image" : "Choose image"}
                </Text>
              </TouchableOpacity>
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setAddItemOpen(false)}>
                  <Text style={styles.modalCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSave}
                  onPress={async () => {
                    await addItem();
                    setAddItemOpen(false);
                  }}
                  disabled={savingAction || uploading}
                >
                  <Text style={styles.modalSaveText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Item</Text>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={editForm.name}
                onChangeText={(v) => setEditForm((s) => ({ ...s, name: v }))}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <Text style={styles.fieldLabel}>Price</Text>
              <TextInput
                value={editForm.price}
                onChangeText={(v) => setEditForm((s) => ({ ...s, price: v }))}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                value={editForm.description}
                onChangeText={(v) => setEditForm((s) => ({ ...s, description: v }))}
                style={styles.input}
                placeholderTextColor="rgba(255,255,255,0.45)"
              />
              <View style={styles.switchRow}>
                <Text style={styles.fieldLabelInline}>Available</Text>
                <Switch
                  value={Boolean(editForm.is_available)}
                  onValueChange={(v) => setEditForm((s) => ({ ...s, is_available: v }))}
                  trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
                  thumbColor={MMD_WHITE}
                />
              </View>
              <TouchableOpacity
                disabled={uploading}
                onPress={async () => {
                  const url = await pickAndUploadMenuImage();
                  if (url) setEditForm((s) => ({ ...s, image_url: url }));
                }}
                style={styles.secondaryBtn}
              >
                {uploading ? <ActivityIndicator color={MMD_WHITE} /> : null}
                <Text style={styles.secondaryBtnText}>
                  {editForm.image_url ? "Change image" : "Choose image"}
                </Text>
              </TouchableOpacity>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => {
                    if (editItemId) void deleteItem(editItemId);
                    closeEdit();
                  }}
                >
                  <Text style={styles.modalDelete}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={closeEdit}>
                  <Text style={styles.modalCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSave}
                  onPress={saveEdit}
                  disabled={editSaving || uploading}
                >
                  {editSaving ? <ActivityIndicator color={MMD_WHITE} /> : null}
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  emptyPad: { flex: 1, padding: 16, justifyContent: "center" },
  emptyContent: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 24,
    alignItems: "flex-start",
  },
  addCategoryBtn: {
    width: "100%",
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  addCategoryBtnText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  emptyCard: {
    width: 320,
    maxWidth: "100%",
    alignSelf: "center",
    alignItems: "center",
    gap: 20,
    padding: 32,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  emptyIcon: { fontSize: 28, color: MMD_WHITE },
  emptyTextStack: { width: "100%", alignItems: "center", gap: 8 },
  emptyTitle: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  emptySubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  menuContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 24,
  },
  tabsRow: { gap: 12, paddingRight: 8 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  tabActive: {
    backgroundColor: MMD_WHITE,
    borderColor: MMD_WHITE,
  },
  tabText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  tabTextActive: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  itemsCol: { gap: 16 },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  itemThumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  itemThumbEmoji: { fontSize: 28 },
  itemMeta: { flex: 1, gap: 6, minWidth: 0 },
  itemName: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  itemPrice: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  statusRow: { flexDirection: "row", alignItems: "center" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeOn: { backgroundColor: "rgba(34,197,94,0.2)" },
  badgeOff: { backgroundColor: "rgba(239,68,68,0.2)" },
  badgeText: {
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  badgeTextOn: { color: MMD_TAXI_GREEN },
  badgeTextOff: { color: "#EF4444" },
  headerAction: {
    backgroundColor: MMD_TAXI_GREEN,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  headerActionText: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 16,
  },
  modalScroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 24 },
  modalCard: {
    backgroundColor: MMD_BLUE,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    gap: 10,
  },
  modalTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginBottom: 4,
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  fieldLabelInline: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
  },
  input: {
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    backgroundColor: MMD_GLASS,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  secondaryBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  secondaryBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  modalCancel: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    padding: 8,
  },
  modalDelete: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    padding: 8,
  },
  modalSave: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalSaveText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
