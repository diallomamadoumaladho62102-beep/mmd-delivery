"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";

type AdminTaxiForceCompletePanelProps = {
  defaultRideId?: string;
  rideStatus?: string | null;
  onCompleted?: () => void;
};

const FORCE_ELIGIBLE = new Set(["in_progress"]);

export default function AdminTaxiForceCompletePanel({
  defaultRideId = "",
  rideStatus = null,
  onCompleted,
}: AdminTaxiForceCompletePanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const status = String(rideStatus ?? "").trim().toLowerCase();
  const eligible = FORCE_ELIGIBLE.has(status);

  async function submit() {
    const rideId = defaultRideId.trim();
    if (!rideId) {
      setResult({ error: "Ride ID manquant." });
      return;
    }

    const confirmed = window.confirm(
      [
        "Force complete this ride?",
        "",
        "This ride is currently too far from the drop-off location. An administrator is manually completing this ride. This action will be recorded in the audit log.",
        "",
        `Ride: ${rideId}`,
        `Status: ${status || "—"}`,
      ].join("\n"),
    );

    if (!confirmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await adminFetch("/api/admin/taxi-rides/force-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxi_ride_id: rideId,
          reason: "admin_force_complete",
        }),
      });
      const json = await res.json().catch(() => ({}));
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
    <section
      id="force-complete"
      className="rounded-2xl border border-amber-300 bg-amber-50/40 p-5 shadow-sm"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          Admin — Force Complete Ride
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Contourne uniquement{" "}
          <code className="rounded bg-slate-100 px-1 text-xs">
            too_far_from_dropoff
          </code>
          . Le chauffeur ne peut pas utiliser cette action. Audit obligatoire.
        </p>
      </div>

      {!eligible ? (
        <p className="text-sm text-slate-500">
          Disponible uniquement quand le statut est{" "}
          <strong>in_progress</strong>
          {status ? ` (actuel : ${status})` : ""}.
        </p>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => void submit()}
          className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Traitement…" : "Force Complete"}
        </button>
      )}

      {result ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-green-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
