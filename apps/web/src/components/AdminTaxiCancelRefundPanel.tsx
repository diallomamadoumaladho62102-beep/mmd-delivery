"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type AdminTaxiCancelRefundPanelProps = {
  defaultRideId?: string;
  defaultReason?: string;
  onCompleted?: () => void;
};

export default function AdminTaxiCancelRefundPanel({
  defaultRideId = "",
  defaultReason = "admin_cancel_refund",
  onCompleted,
}: AdminTaxiCancelRefundPanelProps) {
  const [rideId, setRideId] = useState(defaultRideId);
  const [reason, setReason] = useState(defaultReason);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function submit() {
    const trimmedRideId = rideId.trim();
    const trimmedReason = reason.trim() || "admin_cancel_refund";

    if (!trimmedRideId) {
      setResult({ error: "Ride ID obligatoire." });
      return;
    }

    const confirmed = window.confirm(
      `Tu vas ANNULER et REMBOURSER cette course taxi :\n\n${trimmedRideId}\n\nRaison : ${trimmedReason}\n\nContinuer ?`
    );

    if (!confirmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await adminFetch("/api/admin/taxi-rides/cancel-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId: trimmedRideId,
          reason: trimmedReason,
        }),
      });

      const json = await res.json();
      setResult(json);

      if (res.ok && json?.ok) {
        onCompleted?.();
      }
    } catch (e: unknown) {
      setResult({ error: e instanceof Error ? e.message : "Erreur inconnue" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          Admin — Annuler & rembourser (Taxi)
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Annule la course taxi et rembourse Stripe si elle est payée.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={rideId}
          onChange={(e) => setRideId(e.target.value)}
          placeholder="Taxi Ride ID"
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
