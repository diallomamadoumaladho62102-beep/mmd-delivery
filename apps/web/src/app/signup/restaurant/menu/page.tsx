"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Category = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  category_id: string;
  name: string;
  price: number;
  description: string | null;
  image_url: string | null;
};

export default function RestaurantMenuPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Catégories
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState("");

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemDescription, setNewItemDescription] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const [imageFile, setImageFile] = useState<File | null>(null);

  // Charger user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        console.error(error);
        return;
      }
      const user = data.user;
      const userId = user?.id ?? null;
      setUid(userId);
      if (userId) loadData(userId);
    });
  }, []);

  // Charger catégories + items
  async function loadData(userId: string) {
    setErr(null);

    const { data: categoriesData, error: catErr } = await supabase
      .from("restaurant_categories")
      .select("*")
      .eq("restaurant_id", userId);

    const { data: itemsData, error: itemErr } = await supabase
      .from("restaurant_items")
      .select("*")
      .eq("restaurant_id", userId);

    if (catErr) setErr(catErr.message);
    if (itemErr) setErr(itemErr.message);

    setCategories(categoriesData ?? []);
    setItems(itemsData ?? []);
  }

  // Ajouter une catégorie
  async function addCategory() {
    setErr(null);
    if (!uid || !newCategory.trim()) return;

    const { error } = await supabase.from("restaurant_categories").insert({
      id: crypto.randomUUID(),
      restaurant_id: uid,
      name: newCategory.trim(),
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setNewCategory("");
    loadData(uid);
  }

  // Ajouter un item
  async function addItem() {
    setErr(null);

    if (!uid) {
      setErr("Pas connecté.");
      return;
    }
    if (!selectedCategory) {
      setErr("Choisis une catégorie.");
      return;
    }
    if (!newItemName.trim() || !newItemPrice.trim()) {
      setErr("Nom + prix obligatoires.");
      return;
    }

    const priceNumber = Number(newItemPrice);
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      setErr("Prix invalide.");
      return;
    }

    let image_url: string | null = null;

    // upload image si fournie
    if (imageFile) {
      const ext = imageFile.name.split(".").pop() || "jpg";
      const path = `menu/${uid}/${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from("avatars")
        .upload(path, imageFile, { upsert: true });

      if (error) {
        setErr("Échec upload image: " + error.message);
        return;
      }

      image_url = data?.path ?? null;
    }

    const { error } = await supabase.from("restaurant_items").insert({
      id: crypto.randomUUID(),
      restaurant_id: uid,
      category_id: selectedCategory,
      name: newItemName.trim(),
      price: priceNumber,
      description: newItemDescription || null,
      image_url,
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setNewItemName("");
    setNewItemPrice("");
    setNewItemDescription("");
    setImageFile(null);

    loadData(uid);
  }

  if (!uid) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-lg font-semibold">Menu du restaurant</h1>
        <p>Connecte-toi pour gérer ton menu.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Gérer le menu du restaurant</h1>

      {/* Ajouter catégorie */}
      <section className="border p-4 rounded space-y-2">
        <h2 className="font-semibold">Ajouter une catégorie</h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Ex: Grillades, Boissons, Plats africains…"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        />
        <button
          onClick={addCategory}
          className="px-3 py-2 bg-black text-white rounded"
        >
          Ajouter catégorie
        </button>
      </section>

      {/* Ajouter item */}
      <section className="border p-4 rounded space-y-2">
        <h2 className="font-semibold">Ajouter un plat / item</h2>

        <select
          className="w-full border rounded px-3 py-2"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="">Choisir une catégorie</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Nom du plat"
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
        />

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Prix (ex: 12.50)"
          value={newItemPrice}
          onChange={(e) => setNewItemPrice(e.target.value)}
        />

        <textarea
          className="w-full border rounded px-3 py-2"
          placeholder="Description (optionnelle)"
          value={newItemDescription}
          onChange={(e) => setNewItemDescription(e.target.value)}
        />

        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={addItem}
          className="px-3 py-2 bg-black text-white rounded"
        >
          Ajouter un plat
        </button>
      </section>

      {/* Liste catégories + items */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Menu existant</h2>

        {categories.map((cat) => (
          <div key={cat.id} className="border rounded p-4">
            <h3 className="font-bold text-lg">{cat.name}</h3>

            {items
              .filter((i) => i.category_id === cat.id)
              .map((item) => (
                <div
                  key={item.id}
                  className="mt-2 border-b pb-2 flex gap-3 items-center"
                >
                  {item.image_url && (
                    <img
                      src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${item.image_url}`}
                      className="h-14 w-14 rounded object-cover"
                    />
                  )}

                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-gray-600">${item.price}</p>
                    {item.description && (
                      <p className="text-xs text-gray-500">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </section>

      {err && <div className="text-red-600">{err}</div>}
    </div>
  );
}
