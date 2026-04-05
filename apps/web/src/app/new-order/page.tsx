"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import { computeDeliveryPricing } from "@/lib/deliveryPricing";

type CreateState = "idle" | "loading" | "done";

export default function NewOrderPage() {
  const router = useRouter();

  const [restaurantName, setRestaurantName] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  // Pour l’instant on met les coords à la main pour tester
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");

  const [subtotalInput, setSubtotalInput] = useState("0"); // prix des plats
  const [taxInput, setTaxInput] = useState("0");

  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<CreateState>("idle");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      setState("loading");

      // 1) Vérifier l’utilisateur connecté
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        throw new Error("Utilisateur non connecté");
      }

      const clientId = user.id;

      // 2) Parser les valeurs numériques
      const subtotal = Number(subtotalInput || "0");
      const tax = Number(taxInput || "0");
      if (Number.isNaN(subtotal) || Number.isNaN(tax)) {
        throw new Error("Sous-total ou taxes invalides");
      }

      const pLat = Number(pickupLat);
      const pLng = Number(pickupLng);
      const dLat = Number(dropoffLat);
      const dLng = Number(dropoffLng);

      if (
        Number.isNaN(pLat) ||
        Number.isNaN(pLng) ||
        Number.isNaN(dLat) ||
        Number.isNaN(dLng)
      ) {
        throw new Error("Les coordonnées pickup/dropoff sont invalides");
      }

      // 3) Appel Mapbox → distance + ETA
      const { distanceMiles, etaMinutes } = await getDistanceAndEta(
        { lat: pLat, lng: pLng },
        { lat: dLat, lng: dLng }
      );

      // 4) Calcul des frais de livraison avec ton modèle :
      // base 3$ + 1.20$/mile + 0.03$/minute
      // 25% MMD / 75% driver
      const pricing = computeDeliveryPricing({
        distanceMiles,
        durationMinutes: etaMinutes,
      });

      const deliveryFee = pricing.deliveryFee;
      const driverPayout = pricing.driverPayout;
      const platformFee = pricing.platformFee; // pour info, mais pas nécessaire à stocker ici

      // total = plats + taxes + livraison
      const total = subtotal + tax + deliveryFee;

      // 5) Insert dans orders
      const { data, error: insertErr } = await supabase
        .from("orders")
        .insert({
          // Identité / client
          created_by: clientId,
          client_id: clientId,
          user_id: clientId,

          // Contexte de la commande
          kind: "food",
          order_type: "food",
          pickup_kind: "restaurant",
          restaurant_name: restaurantName || null,

          // Adresses
          pickup_address: pickupAddress || null,
          dropoff_address: dropoffAddress || null,

          pickup_contact_name: null,
          pickup_phone: null,
          dropoff_contact_name: null,
          dropoff_phone: null,

          // Coordonnées géo
          pickup_lat: pLat,
          pickup_lng: pLng,
          dropoff_lat: dLat,
          dropoff_lng: dLng,

          // Montants (version numeric)
          subtotal,
          tax,
          total,
          currency: "USD",

          // Estimations Mapbox
          distance_miles_est: distanceMiles,
          eta_minutes_est: etaMinutes,
          delivery_fee_est: deliveryFee,

          // Valeurs finales pour livraison
          distance_miles: distanceMiles,
          eta_minutes: etaMinutes,
          delivery_fee: deliveryFee,
          delivery_pay: driverPayout, // ce que le driver doit toucher

          // Tu peux aussi laisser les champs *_cents et autres sur leurs defaults
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error(insertErr);
        throw new Error(insertErr.message);
      }

      setState("done");

      // 6) Redirection vers la page de la commande
      if (data?.id) {
        router.push(`/orders/${data.id}`);
      } else {
        router.push("/orders");
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Erreur inconnue lors de la création de la commande");
      setState("idle");
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold mb-2">Nouvelle commande (test Delivery)</h1>
      <p className="text-sm text-gray-600">
        Cette page crée une commande en utilisant Mapbox pour calculer la distance,
        le temps estimé et les frais de livraison (base 3$, 1.20$/mile, 0.03$/minute,
        25% MMD / 75% driver).
      </p>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-4 border rounded-2xl p-4 bg-white">
        <div className="space-y-1">
          <label className="block text-sm font-medium">Nom du restaurant</label>
          <input
            type="text"
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Ex: Mamadou Grill"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Pickup address (restaurant)</label>
          <input
            type="text"
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Adresse du restaurant"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Dropoff address (client)
          </label>
          <input
            type="text"
            value={dropoffAddress}
            onChange={(e) => setDropoffAddress(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
            placeholder="Adresse de livraison"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              Pickup lat (test)
            </label>
            <input
              type="text"
              value={pickupLat}
              onChange={(e) => setPickupLat(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: 40.7128"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              Pickup lng (test)
            </label>
            <input
              type="text"
              value={pickupLng}
              onChange={(e) => setPickupLng(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: -74.0060"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              Dropoff lat (test)
            </label>
            <input
              type="text"
              value={dropoffLat}
              onChange={(e) => setDropoffLat(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: 40.7306"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              Dropoff lng (test)
            </label>
            <input
              type="text"
              value={dropoffLng}
              onChange={(e) => setDropoffLng(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: -73.9352"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium">Sous-total (plats)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={subtotalInput}
              onChange={(e) => setSubtotalInput(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: 25.50"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium">Taxes</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={taxInput}
              onChange={(e) => setTaxInput(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Ex: 2.25"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={state === "loading"}
          className="mt-2 inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {state === "loading" ? "Création en cours..." : "Créer la commande"}
        </button>
      </form>
    </div>
  );
}
