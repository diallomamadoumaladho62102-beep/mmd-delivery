"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type AdminCancelRefundPanelProps = {
  defaultOrderId?: string;
  defaultReason?: string;
  onCompleted?: () => void;
};

export default function AdminCancelRefundPanel({
  defaultOrderId = "",
  defaultReason = "admin_cancel_refund",
  onCompleted,
}: AdminCancelRefundPanelProps) {
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [reason, setReason] = useState(defaultReason);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function submit() {
    const trimmedOrderId = orderId.trim();
    const trimmedReason = reason.trim() || "admin_cancel_refund";

    if (!trimmedOrderId) {
      setResult({ error: "Order ID obligatoire." });
      return;
    }

    const confirmed = window.confirm(
      `⚠️ CONFIRMATION IMPORTANTE\n\nTu vas ANNULER et REMBOURSER cette commande :\n\n${trimmedOrderId}\n\nRaison : ${trimmedReason}\n\nCette action peut déclencher un vrai remboursement Stripe.\n\nContinuer ?`
    );

    if (!confirmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await adminFetch("/api/admin/orders/cancel-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: trimmedOrderId,
          reason: trimmedReason,
        }),
      });

      const json = await res.json();
      setResult(json);

      if (res.ok && json?.ok) {
        onCompleted?.();
      }
    } catch (e: any) {
      setResult({ error: e?.message ?? "Erreur inconnue" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          🛠️ Admin — Annuler & rembourser
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Action admin puissante : annule une commande et rembourse Stripe si elle est payée.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="Order ID"
          className="rounded-xl border px-3 py-2 text-sm"
        />

        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="rounded-xl border px-3 py-2 text-sm"
        />
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={submit}
        className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Traitement…" : "Annuler & rembourser"}
      </button>

      {result ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-green-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}