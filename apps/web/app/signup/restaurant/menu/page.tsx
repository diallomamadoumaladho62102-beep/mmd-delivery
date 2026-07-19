"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

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

type ItemForm = {
  category_id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  image_url: string;
  is_available: boolean;
  position: string;
};

const MENU_BUCKET = "restaurant-menu";
const AVATAR_BUCKET = "avatars";

const emptyItemForm: ItemForm = {
  category_id: "",
  name: "",
  description: "",
  price: "0.00",
  currency: "USD",
  image_url: "",
  is_available: true,
  position: "",
};

function moneyToCents(value: string): number {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function centsToMoneyString(cents: number | null | undefined): string {
  const value = Number(cents ?? 0);
  if (!Number.isFinite(value)) return "0.00";
  return (value / 100).toFixed(2);
}

function getFileExtension(file: File): string {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type.includes("png") || name.endsWith(".png")) return "png";
  if (type.includes("webp") || name.endsWith(".webp")) return "webp";
  return "jpg";
}

function contentTypeFromExt(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function storagePathFromPublicUrl(publicUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + marker.length));
}

async function uploadMenuImage(userId: string, file: File): Promise<string> {
  const ext = getFileExtension(file);
  const path = `restaurants/${userId}/menu/${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(MENU_BUCKET).upload(path, file, {
    contentType: file.type || contentTypeFromExt(ext),
    upsert: true,
  });

  if (error) throw new Error(error.message);

  const publicUrl = supabase.storage.from(MENU_BUCKET).getPublicUrl(path)?.data?.publicUrl;
  if (!publicUrl) throw new Error("Impossible de récupérer l’URL publique de l’image.");

  return publicUrl;
}

export default function RestaurantMenuPage() {
  const [loading, setLoading] = useState(true);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newItem, setNewItem] = useState<ItemForm>(emptyItemForm);
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ItemForm>(emptyItemForm);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (newImagePreview) URL.revokeObjectURL(newImagePreview);
      if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    };
  }, [newImagePreview, editImagePreview]);

  async function refreshAll(userId: string) {
    setErr(null);

    const [categoriesResult, itemsResult] = await Promise.all([
      supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", userId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("restaurant_items")
        .select("*")
        .eq("restaurant_user_id", userId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (itemsResult.error) throw new Error(itemsResult.error.message);

    setCategories((categoriesResult.data ?? []) as Category[]);
    setItems(
      ((itemsResult.data ?? []) as Item[]).map((item) => ({
        ...item,
        image_url: item.image_url?.toString().trim() || null,
      }))
    );
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setErr(null);

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw new Error(error.message);

        const userId = data.session?.user.id ?? null;
        if (!mounted) return;

        setRestaurantUserId(userId);

        if (userId) {
          await refreshAll(userId);
        }
      } catch (error) {
        console.error(error);
        if (mounted) setErr(error instanceof Error ? error.message : "Erreur de chargement.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void boot();

    return () => {
      mounted = false;
    };
  }, []);

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Item[]>();

    for (const item of items) {
      const key = item.category_id ?? "uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(item);
    }

    return map;
  }, [items]);

  function selectedCategoryName(categoryId: string) {
    if (!categoryId) return "Sans catégorie";
    return categories.find((category) => category.id === categoryId)?.name ?? "Sans catégorie";
  }

  async function addCategory() {
    if (!restaurantUserId) return;

    setErr(null);
    setOk(null);

    const name = newCategoryName.trim();
    if (!name) {
      setErr("Nom de catégorie obligatoire.");
      return;
    }

    const { error } = await supabase.from("menu_categories").insert({
      restaurant_id: restaurantUserId,
      name,
      position: categories.length,
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setNewCategoryName("");
    setOk("Catégorie ajoutée ✅");
    await refreshAll(restaurantUserId);
  }

  async function deleteCategory(id: string) {
    if (!restaurantUserId) return;
    if (!window.confirm("Supprimer cette catégorie ? Les produits resteront sans catégorie si la base de données le permet.")) return;

    setErr(null);
    setOk(null);

    const { error } = await supabase.from("menu_categories").delete().eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }

    setOk("Catégorie supprimée ✅");
    await refreshAll(restaurantUserId);
  }

  async function maybeUploadNewImage(): Promise<string | null> {
    if (!restaurantUserId || !newImageFile) return newItem.image_url.trim() || null;

    setUploading(true);
    try {
      return await uploadMenuImage(restaurantUserId, newImageFile);
    } finally {
      setUploading(false);
    }
  }

  async function maybeUploadEditImage(): Promise<string | null> {
    if (!restaurantUserId || !editImageFile) return editForm.image_url.trim() || null;

    setUploading(true);
    try {
      return await uploadMenuImage(restaurantUserId, editImageFile);
    } finally {
      setUploading(false);
    }
  }

  async function addItem() {
    if (!restaurantUserId) return;

    setErr(null);
    setOk(null);

    const name = newItem.name.trim();
    if (!name) {
      setErr("Nom obligatoire.");
      return;
    }

    const priceCents = moneyToCents(newItem.price);
    if (!priceCents || priceCents <= 0) {
      setErr("Prix invalide.");
      return;
    }

    const position = newItem.position.trim() !== "" ? Number(newItem.position) : items.length + 1;

    try {
      const imageUrl = await maybeUploadNewImage();

      const payload = {
        restaurant_user_id: restaurantUserId,
        category_id: newItem.category_id ? newItem.category_id : null,
        name,
        description: newItem.description.trim() ? newItem.description.trim() : null,
        price_cents: priceCents,
        currency: newItem.currency || "USD",
        image_url: imageUrl,
        is_available: Boolean(newItem.is_available),
        position: Number.isFinite(position) ? position : items.length + 1,
      };

      const { error } = await supabase.from("restaurant_items").insert(payload);
      if (error) throw new Error(error.message);

      setNewItem(emptyItemForm);
      setNewImageFile(null);
      if (newImagePreview) URL.revokeObjectURL(newImagePreview);
      setNewImagePreview(null);
      setOk("Produit ajouté ✅");
      await refreshAll(restaurantUserId);
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Impossible d’ajouter le produit.");
    }
  }

  async function toggleAvailable(id: string, value: boolean) {
    if (!restaurantUserId) return;

    const { error } = await supabase
      .from("restaurant_items")
      .update({ is_available: value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_user_id", restaurantUserId);

    if (error) {
      setErr(error.message);
      return;
    }

    await refreshAll(restaurantUserId);
  }

  async function deleteItem(item: Item) {
    if (!restaurantUserId) return;
    if (!window.confirm(`Supprimer ${item.name} ?`)) return;

    setErr(null);
    setOk(null);

    try {
      if (item.image_url) {
        const menuPath = storagePathFromPublicUrl(item.image_url, MENU_BUCKET);
        const avatarPath = storagePathFromPublicUrl(item.image_url, AVATAR_BUCKET);

        if (menuPath) {
          const { error } = await supabase.storage.from(MENU_BUCKET).remove([menuPath]);
          if (error) console.log("remove restaurant-menu image error", error);
        } else if (avatarPath) {
          const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath]);
          if (error) console.log("remove avatar image error", error);
        }
      }

      const { error } = await supabase
        .from("restaurant_items")
        .delete()
        .eq("id", item.id)
        .eq("restaurant_user_id", restaurantUserId);

      if (error) throw new Error(error.message);

      setOk("Produit supprimé ✅");
      await refreshAll(restaurantUserId);
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Suppression impossible.");
    }
  }

  function openEdit(item: Item) {
    setEditItemId(item.id);
    setEditForm({
      category_id: item.category_id ?? "",
      name: item.name ?? "",
      description: item.description ?? "",
      price: centsToMoneyString(item.price_cents),
      currency: item.currency ?? "USD",
      image_url: item.image_url ?? "",
      is_available: Boolean(item.is_available),
      position: item.position != null ? String(item.position) : "",
    });
    setEditImageFile(null);
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImagePreview(null);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditItemId(null);
    setEditSaving(false);
    setEditImageFile(null);
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImagePreview(null);
  }

  async function saveEdit() {
    if (!restaurantUserId || !editItemId) return;

    setErr(null);
    setOk(null);

    const name = editForm.name.trim();
    if (!name) {
      setErr("Nom obligatoire.");
      return;
    }

    const priceCents = moneyToCents(editForm.price);
    if (!priceCents || priceCents <= 0) {
      setErr("Prix invalide.");
      return;
    }

    const position = editForm.position.trim() !== "" ? Number(editForm.position) : null;

    try {
      setEditSaving(true);
      const imageUrl = await maybeUploadEditImage();

      const payload = {
        category_id: editForm.category_id ? editForm.category_id : null,
        name,
        description: editForm.description.trim() ? editForm.description.trim() : null,
        price_cents: priceCents,
        currency: editForm.currency || "USD",
        image_url: imageUrl,
        is_available: Boolean(editForm.is_available),
        position: Number.isFinite(position as number) ? position : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("restaurant_items")
        .update(payload)
        .eq("id", editItemId)
        .eq("restaurant_user_id", restaurantUserId);

      if (error) throw new Error(error.message);

      setOk("Produit modifié ✅");
      await refreshAll(restaurantUserId);
      closeEdit();
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Modification impossible.");
    } finally {
      setEditSaving(false);
    }
  }

  function onNewImageChange(file: File | null) {
    if (newImagePreview) URL.revokeObjectURL(newImagePreview);
    setNewImageFile(file);
    setNewImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function onEditImageChange(file: File | null) {
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(file);
    setEditImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function renderItemCard(item: Item) {
    return (
      <div key={item.id} className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt={item.name} className="h-24 w-24 rounded-xl object-cover bg-slate-100" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500">
              No photo
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="text-lg font-black text-slate-950">{item.name}</h4>
                {item.description && <p className="mt-1 text-sm font-semibold text-slate-500">{item.description}</p>}
                <p className="mt-2 text-sm font-black text-slate-800">
                  ${(item.price_cents / 100).toFixed(2)} {item.currency}
                </p>
              </div>

              <span
                className={`w-fit rounded-full px-3 py-1 text-xs font-black ${
                  item.is_available ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}
              >
                {item.is_available ? "Disponible" : "Indisponible"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(item.is_available)}
                  onChange={(event) => void toggleAvailable(item.id, event.target.checked)}
                />
                Disponible
              </label>

              <button type="button" onClick={() => openEdit(item)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-black text-white">
                Modifier
              </button>

              <button type="button" onClick={() => void deleteItem(item)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-black text-white">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-black">Menu / Produits</h1>
        <p className="mt-3 text-slate-600">Chargement…</p>
      </main>
    );
  }

  if (!restaurantUserId) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-black">Menu du restaurant</h1>
        <p className="mt-3 text-slate-600">Connecte-toi comme restaurant pour gérer ton menu.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">MMD Restaurant</p>
          <h1 className="text-3xl font-black tracking-tight">Menu / Produits</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Gère les catégories, les plats, les images, les prix et la disponibilité.
          </p>
        </div>

        <a href="/restaurant/profile" className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
          Profil restaurant
        </a>
      </div>

      {err && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{err}</div>}
      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{ok}</div>}

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Catégories</h2>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Ex: Pizzas, Boissons, Snacks..."
            className="min-w-0 flex-1 rounded-xl border px-4 py-3 font-semibold outline-none focus:border-blue-500"
          />
          <button type="button" onClick={() => void addCategory()} className="rounded-xl bg-blue-600 px-5 py-3 font-black text-white">
            Ajouter
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {categories.map((category) => (
            <div key={category.id} className="inline-flex items-center gap-3 rounded-full border bg-slate-50 px-4 py-2 text-sm font-black">
              <span>{category.name}</span>
              <button type="button" onClick={() => void deleteCategory(category.id)} className="text-red-600">
                ×
              </button>
            </div>
          ))}

          {categories.length === 0 && <p className="text-sm font-semibold text-slate-500">Aucune catégorie pour l’instant.</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Ajouter un produit</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm font-bold">Catégorie</label>
            <select
              value={newItem.category_id}
              onChange={(event) => setNewItem((state) => ({ ...state, category_id: event.target.value }))}
              className="w-full rounded-xl border px-4 py-3 font-semibold"
            >
              <option value="">Sans catégorie</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <p className="text-xs font-bold text-slate-500">Sélection : {selectedCategoryName(newItem.category_id)}</p>

            <input
              value={newItem.name}
              onChange={(event) => setNewItem((state) => ({ ...state, name: event.target.value }))}
              placeholder="Nom du produit"
              className="w-full rounded-xl border px-4 py-3 font-semibold"
            />

            <textarea
              value={newItem.description}
              onChange={(event) => setNewItem((state) => ({ ...state, description: event.target.value }))}
              placeholder="Description"
              className="w-full rounded-xl border px-4 py-3 font-semibold"
              rows={3}
            />
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
              <input
                value={newItem.price}
                onChange={(event) => setNewItem((state) => ({ ...state, price: event.target.value }))}
                placeholder="Prix (ex: 12.99)"
                inputMode="decimal"
                className="rounded-xl border px-4 py-3 font-semibold"
              />
              <input
                value={newItem.currency}
                onChange={(event) => setNewItem((state) => ({ ...state, currency: event.target.value.toUpperCase() }))}
                placeholder="USD"
                className="rounded-xl border px-4 py-3 font-semibold uppercase"
              />
            </div>

            <input
              value={newItem.position}
              onChange={(event) => setNewItem((state) => ({ ...state, position: event.target.value }))}
              placeholder="Position (optionnel)"
              inputMode="numeric"
              className="w-full rounded-xl border px-4 py-3 font-semibold"
            />

            <label className="inline-flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={newItem.is_available}
                onChange={(event) => setNewItem((state) => ({ ...state, is_available: event.target.checked }))}
              />
              Disponible
            </label>

            <div>
              <label className="mb-2 block text-sm font-bold">Image</label>
              <input type="file" accept="image/*" onChange={(event: ChangeEvent<HTMLInputElement>) => onNewImageChange(event.target.files?.[0] ?? null)} />
              {newImagePreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={newImagePreview} alt="Aperçu" className="mt-3 h-28 w-28 rounded-xl object-cover" />
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void addItem()}
          disabled={uploading}
          className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60"
        >
          {uploading ? "Upload image…" : "Ajouter le produit"}
        </button>
      </section>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Ton menu</h2>

        <div className="mt-4 space-y-6">
          {(itemsByCategory.get("uncategorized") ?? []).length > 0 && (
            <div>
              <h3 className="mb-3 text-xl font-black">Sans catégorie</h3>
              <div className="space-y-3">{(itemsByCategory.get("uncategorized") ?? []).map(renderItemCard)}</div>
            </div>
          )}

          {categories.map((category) => {
            const list = itemsByCategory.get(category.id) ?? [];
            if (!list.length) return null;

            return (
              <div key={category.id}>
                <h3 className="mb-3 text-xl font-black">{category.name}</h3>
                <div className="space-y-3">{list.map(renderItemCard)}</div>
              </div>
            );
          })}

          {items.length === 0 && <p className="text-sm font-semibold text-slate-500">Aucun produit pour le moment.</p>}
        </div>
      </section>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-black">Modifier le produit</h2>
              <button type="button" onClick={closeEdit} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">
                ×
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <select
                value={editForm.category_id}
                onChange={(event) => setEditForm((state) => ({ ...state, category_id: event.target.value }))}
                className="w-full rounded-xl border px-4 py-3 font-semibold"
              >
                <option value="">Sans catégorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              <input
                value={editForm.name}
                onChange={(event) => setEditForm((state) => ({ ...state, name: event.target.value }))}
                placeholder="Nom"
                className="w-full rounded-xl border px-4 py-3 font-semibold"
              />

              <textarea
                value={editForm.description}
                onChange={(event) => setEditForm((state) => ({ ...state, description: event.target.value }))}
                placeholder="Description"
                rows={3}
                className="w-full rounded-xl border px-4 py-3 font-semibold"
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
                <input
                  value={editForm.price}
                  onChange={(event) => setEditForm((state) => ({ ...state, price: event.target.value }))}
                  placeholder="Prix"
                  inputMode="decimal"
                  className="rounded-xl border px-4 py-3 font-semibold"
                />
                <input
                  value={editForm.currency}
                  onChange={(event) => setEditForm((state) => ({ ...state, currency: event.target.value.toUpperCase() }))}
                  placeholder="USD"
                  className="rounded-xl border px-4 py-3 font-semibold uppercase"
                />
              </div>

              <input
                value={editForm.position}
                onChange={(event) => setEditForm((state) => ({ ...state, position: event.target.value }))}
                placeholder="Position"
                inputMode="numeric"
                className="w-full rounded-xl border px-4 py-3 font-semibold"
              />

              <label className="inline-flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={editForm.is_available}
                  onChange={(event) => setEditForm((state) => ({ ...state, is_available: event.target.checked }))}
                />
                Disponible
              </label>

              <div>
                <label className="mb-2 block text-sm font-bold">Image</label>
                <input type="file" accept="image/*" onChange={(event: ChangeEvent<HTMLInputElement>) => onEditImageChange(event.target.files?.[0] ?? null)} />
                {(editImagePreview || editForm.image_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={editImagePreview || editForm.image_url} alt="Aperçu" className="mt-3 h-28 w-28 rounded-xl object-cover" />
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeEdit} disabled={editSaving || uploading} className="rounded-xl bg-slate-100 px-4 py-3 font-black">
                Annuler
              </button>
              <button type="button" onClick={() => void saveEdit()} disabled={editSaving || uploading} className="rounded-xl bg-blue-600 px-4 py-3 font-black text-white disabled:opacity-60">
                {editSaving || uploading ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
