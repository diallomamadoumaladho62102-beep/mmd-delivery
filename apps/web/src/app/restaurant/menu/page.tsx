"use client";

import { useEffect, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type CategoryRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at?: string;
};

type ItemRow = {
  id: string;
  user_id: string; // ✅ on revient sur user_id
  category_id: string;
  name: string;
  price: number;
  currency: string;
  description: string | null;
  image_path: string | null;
  is_available: boolean;
  created_at?: string;
};

type AccountInfo = {
  full_name: string | null;
  email: string | null;
};

export default function RestaurantMenuPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Form catégorie
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");

  // Form plat
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState<string>("");
  const [itemCurrency, setItemCurrency] = useState("USD");
  const [itemCategoryId, setItemCategoryId] = useState<string>("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemImageFile, setItemImageFile] = useState<File | null>(null);

  const [savingCategory, setSavingCategory] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  // Charger user + profil + menu
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      setOk(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        if (!cancelled) setErr(userError.message);
        setLoading(false);
        return;
      }

      if (!user) {
        if (!cancelled) {
          setErr("Tu dois être connecté pour gérer ton menu.");
        }
        setLoading(false);
        return;
      }

      const uid = user.id;
      if (cancelled) return;
      setUserId(uid);

      // Profil (nom + email)
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", uid)
        .maybeSingle();

      if (!cancelled) {
        setAccount({
          full_name: profileRow?.full_name ?? null,
          email: profileRow?.email ?? user.email ?? null,
        });
      }

      // Catégories (lié à user_id)
      const { data: catRows, error: catError } = await supabase
        .from("restaurant_categories")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: true });

      if (catError && !cancelled) {
        setErr(catError.message);
      }

      // Plats (lié à user_id aussi)
      const { data: itemRows, error: itemError } = await supabase
        .from("restaurant_items")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: true });

      if (itemError && !cancelled) {
        setErr(itemError.message);
      }

      if (!cancelled) {
        setCategories((catRows || []) as CategoryRow[]);
        setItems((itemRows || []) as ItemRow[]);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Ajouter une catégorie
  async function onSubmitCategory(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    if (!catName.trim()) {
      setErr("Le nom de la catégorie est obligatoire.");
      return;
    }

    setSavingCategory(true);
    setErr(null);
    setOk(null);

    const payload = {
      user_id: userId,
      name: catName.trim(),
      description: catDesc.trim() || null,
    };

    const { data, error } = await supabase
      .from("restaurant_categories")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      setErr(error.message);
    } else if (data) {
      setCategories((prev) => [...prev, data as CategoryRow]);
      setCatName("");
      setCatDesc("");
      setOk("Catégorie ajoutée ✅");
    }

    setSavingCategory(false);
  }

  // Ajouter un plat
  async function onSubmitItem(e: FormEvent) {
    e.preventDefault();
    if (!userId) return;
    if (!itemName.trim()) {
      setErr("Le nom du plat est obligatoire.");
      return;
    }
    if (!itemCategoryId) {
      setErr("Sélectionne une catégorie.");
      return;
    }

    const normalizedPrice = itemPrice.replace(",", ".");
    const priceNumber = Number(normalizedPrice);
    if (!priceNumber || priceNumber <= 0) {
      setErr("Le prix doit être un nombre positif (ex: 15.99).");
      return;
    }

    setSavingItem(true);
    setErr(null);
    setOk(null);

    let imagePath: string | null = null;

    // Upload de l'image (optionnel)
    if (itemImageFile) {
      const ext = itemImageFile.name.split(".").pop() || "jpg";
      const path = `${userId}/menu_item_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("restaurant-menu")
        .upload(path, itemImageFile);

      if (uploadError) {
        if (
          uploadError.message &&
          uploadError.message.toLowerCase().includes("bucket not found")
        ) {
          setErr(
            'Bucket "restaurant-menu" introuvable dans Supabase Storage. Vérifie que le bucket existe bien avec ce nom exact.'
          );
        } else {
          setErr(uploadError.message);
        }
        setSavingItem(false);
        return;
      }

      imagePath = path;
    }

    const payload = {
      user_id: userId, // ✅ on utilise user_id ici
      category_id: itemCategoryId,
      name: itemName.trim(),
      price: priceNumber,
      currency: itemCurrency || "USD",
      description: itemDesc.trim() || null,
      image_path: imagePath,
      is_available: true,
    };

    const { data, error } = await supabase
      .from("restaurant_items")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      setErr(error.message);
    } else if (data) {
      setItems((prev) => [...prev, data as ItemRow]);
      setItemName("");
      setItemPrice("");
      setItemDesc("");
      setItemImageFile(null);
      setOk("Plat ajouté ✅");
    }

    setSavingItem(false);
  }

  // Toggle dispo (Disponible / Indisponible)
  async function toggleAvailability(item: ItemRow) {
    setErr(null);
    setOk(null);
    setTogglingItemId(item.id);

    const { error } = await supabase
      .from("restaurant_items")
      .update({ is_available: !item.is_available })
      .eq("id", item.id);

    if (error) {
      setErr(error.message);
      setTogglingItemId(null);
      return;
    }

    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, is_available: !row.is_available } : row
      )
    );
    setTogglingItemId(null);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-2">Menu du restaurant</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <h1 className="text-2xl font-bold">Menu du restaurant</h1>
        <p className="mt-2 text-sm text-red-600">
          Tu dois être connecté en tant que restaurant pour gérer ton menu.
        </p>
      </div>
    );
  }

  const hasMenu = categories.length > 0;

  // Regrouper les plats par catégorie
  const itemsByCategory: Record<string, ItemRow[]> = {};
  for (const item of items) {
    const key = item.category_id ?? "__no_category__";
    if (!itemsByCategory[key]) itemsByCategory[key] = [];
    itemsByCategory[key].push(item);
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Menu du restaurant</h1>
          <p className="text-sm text-gray-600">
            {account?.full_name
              ? `Restaurant de ${account.full_name}`
              : "Gère ici ton menu comme sur Uber Eats."}
          </p>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {ok && <p className="text-sm text-green-600">{ok}</p>}

      {/* Bloc Ajouter une catégorie */}
      <div className="border rounded-lg p-4 space-y-3 bg-white">
        <h2 className="text-lg font-semibold">Ajouter une catégorie</h2>
        <form onSubmit={onSubmitCategory} className="space-y-3">
          <div>
            <label className="block text-sm font-medium">
              Nom de la catégorie
            </label>
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Plats africains, Boissons, Desserts…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">
              Description (optionnel)
            </label>
            <textarea
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              rows={2}
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
              placeholder="Description courte de la catégorie"
            />
          </div>
          <button
            type="submit"
            disabled={savingCategory}
            className="inline-flex items-center px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-60"
          >
            {savingCategory ? "Ajout…" : "Ajouter la catégorie"}
          </button>
        </form>
      </div>

      {/* Bloc Ajouter un plat */}
      <div className="border rounded-lg p-4 space-y-3 bg-white">
        <h2 className="text-lg font-semibold">Ajouter un plat</h2>
        <form onSubmit={onSubmitItem} className="space-y-3">
          <div>
            <label className="block text-sm font-medium">Nom du plat</label>
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Thieb, Yassa, Poulet braisé…"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium">Prix</label>
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1"
                value={itemPrice}
                onChange={(e) => setItemPrice(e.target.value)}
                placeholder="15.99"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Devise</label>
              <select
                className="mt-1 w-full border rounded px-2 py-1"
                value={itemCurrency}
                onChange={(e) => setItemCurrency(e.target.value)}
              >
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Catégorie</label>
              <select
                className="mt-1 w-full border rounded px-2 py-1"
                value={itemCategoryId}
                onChange={(e) => setItemCategoryId(e.target.value)}
              >
                <option value="">Choisir…</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">
              Description (optionnel)
            </label>
            <textarea
              className="mt-1 w-full border rounded px-2 py-1 text-sm"
              rows={2}
              value={itemDesc}
              onChange={(e) => setItemDesc(e.target.value)}
              placeholder="Ingrédients, taille de portion, etc."
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Photo du plat (optionnel)
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 text-sm"
              onChange={(e) =>
                setItemImageFile(e.target.files?.[0] ?? null)
              }
            />
          </div>

          <button
            type="submit"
            disabled={savingItem || !hasMenu}
            className="inline-flex items-center px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-60"
          >
            {savingItem ? "Ajout…" : "Ajouter le plat"}
          </button>

          {!hasMenu && (
            <p className="text-xs text-gray-600 mt-1">
              Crée d’abord une catégorie pour pouvoir ajouter des plats.
            </p>
          )}
        </form>
      </div>

      {/* MENU ACTUEL */}
      <div className="border rounded-lg p-4 space-y-3 bg-white">
        <h2 className="text-lg font-semibold">Ton menu actuel</h2>

        {!hasMenu ? (
          <p className="text-sm text-gray-600">
            Tu n’as pas encore de menu. Ajoute une catégorie puis un plat.
          </p>
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => {
              const catItems = itemsByCategory[cat.id] ?? [];
              return (
                <div
                  key={cat.id}
                  className="border rounded-md p-3 space-y-2 bg-gray-50"
                >
                  <div className="flex items-center justify_between">
                    <div>
                      <h3 className="text-base font-semibold">{cat.name}</h3>
                      {cat.description && (
                        <p className="text-xs text-gray-600">
                          {cat.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {catItems.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      Aucun plat encore dans cette catégorie.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {catItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-3 border-t pt-2"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {item.name}{" "}
                              <span className="text-xs text-gray-500">
                                {item.currency} {item.price.toFixed(2)}
                              </span>
                            </p>
                            {item.description && (
                              <p className="text-xs text-gray-600">
                                {item.description}
                              </p>
                            )}
                            {item.image_path && (
                              <p className="text-[11px] text-gray-500">
                                Image enregistrée (bucket{" "}
                                <span className="font-mono">
                                  restaurant-menu
                                </span>
                                ).
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <button
                              type="button"
                              disabled={togglingItemId === item.id}
                              onClick={() => toggleAvailability(item)}
                              className={`px-3 py-1 rounded text-xs font-medium ${
                                item.is_available
                                  ? "bg-emerald-600 text-white"
                                  : "bg-gray-300 text-gray-800"
                              } disabled:opacity-60`}
                            >
                              {togglingItemId === item.id
                                ? "…"
                                : item.is_available
                                ? "Disponible"
                                : "Indisponible"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
