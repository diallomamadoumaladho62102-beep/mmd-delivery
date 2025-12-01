"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Profile = {
  id: string;
  role: string | null;
  full_name: string | null;
};

type OrderKind = "food" | "errand" | "other";

type Item = {
  id: number; // id local pour React
  name: string;
  quantity: number;
  unitPrice: number;
};

const TAX_RATE = 0.08875; // ~8.875% NYC

export default function NewOrderPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [restaurants, setRestaurants] = useState<Profile[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);

  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [kind, setKind] = useState<OrderKind>("food");

  // restaurant choisi = id du profil restaurant
  const [selectedRestaurant, setSelectedRestaurant] = useState<string>("");

  // panier
  const [items, setItems] = useState<Item[]>([
    { id: 1, name: "", quantity: 1, unitPrice: 0 },
  ]);

  // 🧮 calculs
  const subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)} = useMemo(() => {
    return items.reduce((sum, it) => {
      const q = Number(it.quantity) || 0;
      const p = Number(it.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [items]);

  const tax = useMemo(() => {
    return +(subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)} * TAX_RATE).toFixed(2);
  }, [subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}]);

  const Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)} = useMemo(() => {
    return +(subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)} + tax).toFixed(2);
  }, [subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}, tax]);

  // 🔐 charger mon profil
  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (userErr) {
        setErr(userErr.message);
        setLoadingProfile(false);
        return;
      }

      if (!user) {
        setErr("Tu dois être connecté pour créer une commande.");
        setLoadingProfile(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        setErr(error.message);
        setLoadingProfile(false);
        return;
      }

      setProfile(data as Profile);
      setLoadingProfile(false);
    }

    loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  // 🍽️ charger les restaurants (profiles.role = 'restaurant')
  useEffect(() => {
    let mounted = true;

    async function loadRestaurants() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name")
        .eq("role", "restaurant")
        .order("full_name", { ascending: true });

      if (!mounted) return;

      if (error) {
        setErr(error.message);
        return;
      }

      setRestaurants(data || []);
      setLoadingRestaurants(false);
    }

    loadRestaurants();
    return () => {
      mounted = false;
    };
  }, []);

  // 🧾 gestion panier
  const updateItem = (id: number, field: keyof Item, value: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              [field]:
                field === "quantity" || field === "unitPrice"
                  ? Number(value)
                  : value,
            }
          : it
      )
    );
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: prev.length ? prev[prev.length - 1].id + 1 : 1,
        name: "",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // ✅ submit = créer la commande
  const handleSubmit = async () => {
    setErr(null);

    if (!profile) {
      setErr("Profil inaccessible");
      return;
    }

    if (!selectedRestaurant) {
      setErr("Choisis un restaurant.");
      return;
    }

    if (!items.length || subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)} <= 0) {
      setErr("Ajoute au moins un article avec un prix > 0.");
      return;
    }

    setSubmitting(true);

    try {
      // re-vérifie l'utilisateur connecté
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        setErr("Impossible de récupérer l'utilisateur connecté");
        setSubmitting(false);
        return;
      }

      // JSON pour items_json
      const itemsJson = items.map((it) => ({
        name: it.name,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        line_Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}: +(it.quantity * it.unitPrice).toFixed(2),
      }));

      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .insert({
          kind,               // enum order_kind
          status: "pending",  // statut initial
          created_by: user.id,
          client_id: profile.id,
          restaurant_id: selectedRestaurant,
          items_json: itemsJson,
          subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}: +subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}.toFixed(2),
          tax,
          Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)},
          currency: "USD",
        })
        .select("id")
        .single();

      if (orderErr) {
        setErr(orderErr.message);
        setSubmitting(false);
        return;
      }

      const orderId = order.id;

      // Pour l'instant : on va vers la page détail commande (sans chat)
      router.push(`/orders/${orderId}`);
      setSubmitting(false);
    } catch (e: any) {
      setErr(e.message || "Erreur inconnue");
      setSubmitting(false);
    }
  };

  if (loadingProfile || loadingRestaurants) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-semibold mb-2">Nouvelle commande</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-semibold text-center">
            Créer une commande
          </h1>
          <p className="text-sm text-gray-600 text-center">
            Aucun profil trouvé.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm"
          >
            Aller vers l'inscription
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-6 space-y-4">
        <button
          onClick={() => router.push("/orders")}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Mes commandes
        </button>

        <h1 className="text-xl font-semibold">Créer une nouvelle commande</h1>

        {err && (
          <div className="border border-red-300 bg-red-50 text-red-800 p-2 rounded text-sm">
            {err}
          </div>
        )}

        <div className="text-sm">
          <p>
            Connecté en tant que{" "}
            <span className="font-mono">
              {profile.full_name || profile.id}
            </span>
          </p>
          <p className="text-xs text-gray-500">
            Rôle : <span className="font-mono">{profile.role}</span>
          </p>
        </div>

        {/* Type de commande */}
        <section className="border rounded-lg p-4 space-y-2 bg-white">
          <label className="block text-sm font-medium">
            Type de commande
          </label>
          <select
            className="border rounded px-2 py-1 w-full"
            value={kind}
            onChange={(e) => setKind(e.target.value as OrderKind)}
          >
            <option value="food">Food</option>
            <option value="errand">Courses / Errand</option>
            <option value="other">Autre</option>
          </select>
          <p className="text-xs text-gray-500">
            Correspond à l&apos;enum <code>order_kind</code>.
          </p>
        </section>

        {/* Choix du restaurant */}
        <section className="border rounded-lg p-4 space-y-2 bg-white">
          <h2 className="font-semibold text-lg">Restaurant</h2>
          <select
            className="w-full border rounded px-3 py-2"
            value={selectedRestaurant}
            onChange={(e) => setSelectedRestaurant(e.target.value)}
          >
            <option value="">– Choisir un restaurant –</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name || r.id}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            Liste basée sur <code>profiles.role = 'restaurant'</code>.
          </p>
        </section>

        {/* Panier */}
        <section className="border rounded-lg p-4 space-y-3 bg-white">
          <h2 className="font-semibold text-lg">Panier</h2>

          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-12 gap-2 items-center border rounded-lg px-2 py-2"
              >
                <input
                  className="col-span-5 border rounded px-2 py-1"
                  placeholder="Nom de l'article"
                  value={it.name}
                  onChange={(e) => updateItem(it.id, "name", e.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  className="col-span-2 border rounded px-2 py-1"
                  placeholder="Qté"
                  value={it.quantity}
                  onChange={(e) =>
                    updateItem(it.id, "quantity", e.target.value)
                  }
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="col-span-3 border rounded px-2 py-1"
                  placeholder="Prix"
                  value={it.unitPrice}
                  onChange={(e) =>
                    updateItem(it.id, "unitPrice", e.target.value)
                  }
                />
                <div className="col-span-2 flex items-center justify-between">
                  <span className="text-sm">
                    ${(it.quantity * it.unitPrice).toFixed(2)}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-red-600 underline"
                      onClick={() => removeItem(it.id)}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="mt-2 text-sm px-3 py-1 border rounded-full"
          >
            + Ajouter un article
          </button>
        </section>

        {/* Résumé prix */}
        <section className="border rounded-lg p-4 space-y-2 bg-white">
          <h2 className="font-semibold text-lg">Prix</h2>
          <div className="flex justify-between text-sm">
            <span>Sous-Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}</span>
            <span>${subTotal
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Taxes (~{(TAX_RATE * 100).toFixed(2)}%)</span>
            <span>${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base border-t pt-2 mt-1">
            <span>Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}</span>
            <span>${Total
{/* Bloc livraison (estimation) */}
{distanceMiles != null && etaMinutes != null && deliveryFee != null && (
  <div className="border rounded-xl p-4 space-y-2 bg-white mt-4">
    <h2 className="text-lg font-semibold">Livraison estimée</h2>

    <p className="text-sm">
      <span className="font-medium">Distance :</span>{" "}
      {distanceMiles.toFixed(2)} mi
    </p>

    <p className="text-sm">
      <span className="font-medium">Temps estimé :</span>{" "}
      {etaMinutes} min
    </p>

    <p className="text-sm">
      <span className="font-medium">Frais de livraison :</span>{" "}
      {deliveryFee.toFixed(2)} {currency}
    </p>

    <div className="border-t pt-2">
      <p className="font-semibold text-md">
        Total estimé : {(subtotal + tax + deliveryFee).toFixed(2)} {currency}
      </p>
    </div>
  </div>
)}.toFixed(2)}</span>
          </div>
        </section>

        {/* Bouton créer */}
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="w-full px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {submitting ? "Création…" : "Créer la commande"}
        </button>

        <p className="text-xs text-gray-500">
          Après la création, tu seras redirigé vers /orders/[id].
        </p>
      </div>
    </div>
  );
}

