"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { businessApi } from "@/components/business/businessApi";
import {
  BusinessEmptyCard,
  BusinessErrorBanner,
  BusinessLoadingState,
} from "@/components/business/BusinessShell";
import { bizCard, money } from "@/components/business/businessUi";

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

type Tab = "all" | "pending" | "approved" | "rejected";

export default function BusinessApprovalsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rides, setRides] = useState<PendingRide[]>([]);
  const [tab, setTab] = useState<Tab>("pending");

  const refresh = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      router.replace("/login");
      return;
    }
    const out = await businessApi("/api/taxi/business/rides/pending");
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
      await businessApi(path, {
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

  const pending = useMemo(
    () =>
      rides.filter((r) =>
        ["pending", "needs_approval", "awaiting_approval"].includes(
          String(r.business_approval_status || "pending").toLowerCase()
        )
      ),
    [rides]
  );

  const filtered = useMemo(() => {
    if (tab === "all") return rides;
    if (tab === "pending") return pending;
    return rides.filter(
      (r) =>
        String(r.business_approval_status || "").toLowerCase() === tab ||
        String(r.status || "").toLowerCase() === tab
    );
  }, [pending, rides, tab]);

  if (loading) {
    return (
      <BusinessLoadingState
        title="Loading pending approvals..."
        subtitle="Please wait"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[30px] font-bold text-white">Ride Approvals</h1>
        <p className="mt-2 text-sm text-white/70">
          Review business rides that require manager approval.
        </p>
      </div>

      {error ? <BusinessErrorBanner message={error} /> : null}

      <div className={`${bizCard} flex flex-wrap gap-3 p-4`}>
        <StatPill color="#F59E0B" label={`${pending.length} Pending`} />
        <StatPill
          color="#22C55E"
          label={`${rides.filter((r) => String(r.business_approval_status).toLowerCase() === "approved").length} Approved`}
        />
        <StatPill
          color="#EF4444"
          label={`${rides.filter((r) => String(r.business_approval_status).toLowerCase() === "rejected").length} Rejected`}
        />
      </div>

      <div className="flex flex-wrap gap-2.5">
        {(
          [
            ["all", "All"],
            ["pending", "Pending"],
            ["approved", "Approved"],
            ["rejected", "Rejected"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-xl border border-[#78350F] bg-[#78350F] px-3.5 py-2.5 text-[13px] font-extrabold text-[#FCD34D]"
                : "rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] font-bold text-white/80"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <BusinessEmptyCard
          title="No pending approvals"
          description="New ride requests that need manager approval will appear here."
          actionLabel="Back to Dashboard"
          href="/business"
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((ride) => {
            const status = String(
              ride.business_approval_status || "pending"
            ).toLowerCase();
            const isPending = [
              "pending",
              "needs_approval",
              "awaiting_approval",
            ].includes(status);
            return (
              <li key={ride.id} className={`${bizCard} flex flex-col gap-3 p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-white">
                      {ride.client_name ?? "Team member"}
                      {ride.vehicle_class ? ` · ${ride.vehicle_class}` : ""}
                    </p>
                    <p className="mt-1 text-[13px] text-white/70">
                      {ride.pickup_address ?? "Pickup"} →{" "}
                      {ride.dropoff_address ?? "Dropoff"}
                    </p>
                    <p className="mt-1 text-[13px] text-white/70">
                      {new Date(ride.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <p className="text-base font-extrabold text-white">
                      {money(
                        Number(ride.total_cents ?? 0),
                        ride.currency ?? "USD"
                      )}
                    </p>
                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold capitalize text-[#FBBF24]">
                      {status || "pending"}
                    </span>
                  </div>
                </div>
                {isPending ? (
                  <div className="flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      disabled={busyId === ride.id}
                      onClick={() => void act(ride.id, "approve")}
                      className="rounded-[14px] bg-[#22C55E] px-4 py-3 text-[13px] font-extrabold text-white shadow-[0px_10px_12px_rgba(34,197,94,0.2)] disabled:opacity-60"
                    >
                      {busyId === ride.id ? "…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === ride.id}
                      onClick={() => void act(ride.id, "reject")}
                      className="rounded-[14px] bg-[#7F1D1D] px-4 py-3 text-[13px] font-extrabold text-white shadow-[0px_10px_12px_rgba(127,29,29,0.2)] disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatPill({ color, label }: { color: string; label: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] font-bold text-white/80">
      <span className="size-2.5 rounded-[5px]" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
}
