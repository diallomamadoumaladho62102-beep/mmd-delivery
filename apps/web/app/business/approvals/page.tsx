"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import Button from "@/components/Button";

type PendingRide = {
  id: string;
  status: string;
  business_approval_status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
  vehicle_class: string | null;
  client_name: string | null;
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("login_required");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

export default function BusinessApprovalsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<PendingRide[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await api("/api/taxi/business/rides/pending");
    setRides((out.rides ?? []) as PendingRide[]);
  }, [router]);

  useEffect(() => {
    void refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function act(rideId: string, action: "approve" | "reject") {
    setBusyId(rideId);
    setError(null);
    try {
      const path =
        action === "approve"
          ? "/api/taxi/business/rides/approve"
          : "/api/taxi/business/rides/reject";
      await api(path, {
        method: "POST",
        body: JSON.stringify({ taxi_ride_id: rideId }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action}_failed`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-slate-400">Loading pending approvals…</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Ride approvals</h1>
      <p className="mt-2 text-slate-400">
        Review business rides that require manager approval.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      ) : null}

      {rides.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-slate-400">
          No pending approvals.
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {rides.map((ride) => (
            <li
              key={ride.id}
              className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-bold">
                    {ride.client_name ?? "Team member"} ·{" "}
                    {ride.vehicle_class ?? "ride"}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {ride.pickup_address ?? "—"} → {ride.dropoff_address ?? "—"}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {new Date(ride.created_at).toLocaleString()} ·{" "}
                    {money(Number(ride.total_cents ?? 0), ride.currency ?? "USD")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    loading={busyId === ride.id}
                    onClick={() => void act(ride.id, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busyId === ride.id}
                    onClick={() => void act(ride.id, "reject")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
