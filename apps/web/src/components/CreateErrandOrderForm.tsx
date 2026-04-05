"use client";
import { useState } from "react";

export default function CreateErrandOrderForm() {
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [pickupContact, setPickupContact] = useState("");
  const [dropoffContact, setDropoffContact] = useState("");
  const [desc, setDesc] = useState("");
  const [subtotal, setSubtotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/errands/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pickupAddress,
          dropoffAddress,
          pickupContact,
          dropoffContact,
          desc,
          subtotal,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert("Erreur: " + t);
        return;
      }
      const data = await res.json();
      if (data?.id) {
        window.location.href = `/orders/${data.id}/chat`;
      } else {
        alert("Commande créée, mais ID introuvable.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 p-4 border rounded">
      <h3 className="font-semibold text-lg">Créer une course (Errand)</h3>
      <input
        className="border rounded px-3 py-2 w-full"
        placeholder="Adresse de prise"
        value={pickupAddress}
        onChange={(e) => setPickupAddress(e.target.value)}
      />
      <input
        className="border rounded px-3 py-2 w-full"
        placeholder="Adresse de dépôt"
        value={dropoffAddress}
        onChange={(e) => setDropoffAddress(e.target.value)}
      />
      <input
        className="border rounded px-3 py-2 w-full"
        placeholder="Contact prise (nom/tel)"
        value={pickupContact}
        onChange={(e) => setPickupContact(e.target.value)}
      />
      <input
        className="border rounded px-3 py-2 w-full"
        placeholder="Contact dépôt (nom/tel)"
        value={dropoffContact}
        onChange={(e) => setDropoffContact(e.target.value)}
      />
      <textarea
        className="border rounded px-3 py-2 w-full"
        placeholder="Description / consignes"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
      />
      <input
        className="border rounded px-3 py-2 w-full"
        type="number"
        min={0}
        step="0.01"
        placeholder="Sous-total estimé ($)"
        value={Number.isFinite(subtotal) ? subtotal : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setSubtotal(Number.isFinite(v) ? v : 0);
        }}
      />
      <button
        onClick={submit}
        disabled={loading}
        className="px-4 py-2 rounded bg-black text-white"
      >
        {loading ? "Création…" : "Créer"}
      </button>
    </div>
  );
}

