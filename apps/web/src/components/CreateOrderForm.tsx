"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";

export default function CreateOrderForm() {
  const { t } = useAdminT();

  const [kind, setKind] = useState<"food"|"errand">("food");
  const [pickupKind, setPickupKind] = useState<"restaurant"|"home"|"store">("restaurant");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");

  async function submit() {
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          pickup_kind: pickupKind,
          pickup_address: pickupAddress,
          dropoff_address: dropoffAddress
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) alert(json?.error ?? t("Échec de la création de la commande"));
      else alert(t("Commande créée"));
    } catch {
      alert(t("Réseau indisponible. Veuillez réessayer."));
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e)=>{e.preventDefault();submit();}}>
      <div>
        <label className="block text-sm">{t("Type de course")}</label>
        <select value={kind} onChange={(e)=>setKind(e.target.value as any)} className="border rounded px-2 py-1">
          <option value="food">{t("Livraison nourriture")}</option>
          <option value="errand">{t("Récupérer un objet (maison / magasin)")}</option>
        </select>
      </div>
      <div>
        <label className="block text-sm">{t("Lieu de prise")}</label>
        <select value={pickupKind} onChange={(e)=>setPickupKind(e.target.value as any)} className="border rounded px-2 py-1">
          <option value="restaurant">{t("Restaurant")}</option>
          <option value="home">{t("Maison")}</option>
          <option value="store">{t("Magasin")}</option>
        </select>
      </div>
      <div>
        <label className="block text-sm">{t("Adresse de prise")}</label>
        <input value={pickupAddress} onChange={(e)=>setPickupAddress(e.target.value)} className="border rounded px-2 py-1 w-full" />
      </div>
      <div>
        <label className="block text-sm">{t("Adresse de dépôt")}</label>
        <input value={dropoffAddress} onChange={(e)=>setDropoffAddress(e.target.value)} className="border rounded px-2 py-1 w-full" />
      </div>
      <button className="px-3 py-2 bg-black text-white rounded">{t("Créer")}</button>
    </form>
  );
}

