"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AdminGate from "@/components/AdminGate";
import AdminTaxiCancelRefundPanel from "@/components/AdminTaxiCancelRefundPanel";
import { canManageTaxiRides, canManageTaxiPayouts } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type TaxiEvent = {
  id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  triggered_role: string | null;
  description: string | null;
  created_at: string;
};

type TaxiRide = Record<string, unknown> & {
  id: string;
  status: string | null;
  vehicle_class: string | null;
  payment_status: string | null;
  refund_status: string | null;
  total_cents: number | null;
  driver_payout_cents: number | null;
  platform_fee_cents: number | null;
  currency: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  created_at: string | null;
};

type ProfileSnippet = {
  id: string;
  full_name: string | null;
  phone: string | null;
};

type Commission = {
  driver_cents: number | null;
  platform_cents: number | null;
  driver_paid_out: boolean | null;
  driver_transfer_id: string | null;
  driver_paid_out_at: string | null;
};

function formatMoney(cents: number | null | undefined, currency = "USD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number(cents) / 100);
}

export default function AdminTaxiRideDetailPage() {
  const params = useParams<{ rideId: string }>();
  const rideId = typeof params?.rideId === "string" ? params.rideId : "";

  const [ride, setRide] = useState<TaxiRide | null>(null);
  const [events, setEvents] = useState<TaxiEvent[]>([]);
  const [client, setClient] = useState<ProfileSnippet | null>(null);
  const [driver, setDriver] = useState<ProfileSnippet | null>(null);
  const [commission, setCommission] = useState<Commission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canPayout, setCanPayout] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutResult, setPayoutResult] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    if (!rideId) return;

    setLoading(true);
    setError(null);

    const session = await resolveBrowserStaffSession();
    setCanManage(canManageTaxiRides(session?.role ?? null));
    setCanPayout(canManageTaxiPayouts(session?.role ?? null));

    const res = await adminFetch(`/api/admin/taxi-rides/${rideId}`);
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setLoading(false);
      return;
    }

    setRide(body.ride ?? null);
    setEvents(body.events ?? []);
    setClient(body.client ?? null);
    setDriver(body.driver ?? null);
    setCommission(body.commission ?? null);
    setLoading(false);
  }, [rideId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPayout(dryRun: boolean) {
    if (!rideId) return;

    setPayoutLoading(true);
    setPayoutResult(null);

    try {
      const res = await adminFetch("/api/stripe/transfers/taxi-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxi_ride_id: rideId, dry_run: dryRun }),
      });
      const json = await res.json();
      setPayoutResult(json);
      if (res.ok && json?.ok && !dryRun) {
        await load();
      }
    } catch (e: unknown) {
      setPayoutResult({ error: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setPayoutLoading(false);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <header className="space-y-2">
            <Link href="/admin/taxi-rides" className="text-sm text-blue-700 underline">
              ← Retour aux courses taxi
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">Course taxi</h1>
            <p className="font-mono text-xs text-slate-500">{rideId}</p>
          </header>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : ride ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Résumé</h2>
                <div className="mt-3 space-y-1 text-sm">
                  <div>Statut : {ride.status ?? "—"}</div>
                  <div>Classe : {ride.vehicle_class ?? "—"}</div>
                  <div>Paiement : {ride.payment_status ?? "—"}</div>
                  <div>Remboursement : {ride.refund_status ?? "—"}</div>
                  <div>
                    Total : {formatMoney(ride.total_cents as number, ride.currency as string)}
                  </div>
                  <div>
                    Driver payout :{" "}
                    {formatMoney(ride.driver_payout_cents as number, ride.currency as string)}
                  </div>
                  <div>Pickup : {ride.pickup_address ?? "—"}</div>
                  <div>Dropoff : {ride.dropoff_address ?? "—"}</div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Participants</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 text-sm">
                  <div>
                    <div className="font-medium text-slate-700">Client</div>
                    <div>{client?.full_name ?? "—"}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {ride.client_user_id ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-700">Chauffeur</div>
                    <div>{driver?.full_name ?? "—"}</div>
                    <div className="font-mono text-xs text-slate-500">
                      {ride.driver_id ?? "—"}
                    </div>
                  </div>
                </div>
              </section>

              {commission ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">Commission taxi</h2>
                  <div className="mt-3 space-y-1 text-sm">
                    <div>Driver : {formatMoney(commission.driver_cents, ride.currency as string)}</div>
                    <div>
                      Platform :{" "}
                      {formatMoney(commission.platform_cents, ride.currency as string)}
                    </div>
                    <div>
                      Payé : {commission.driver_paid_out ? "oui" : "non"}
                      {commission.driver_transfer_id
                        ? ` · ${commission.driver_transfer_id}`
                        : ""}
                    </div>
                  </div>

                  {canPayout && ride.status === "completed" && ride.payment_status === "paid" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={payoutLoading || !!commission.driver_paid_out}
                        onClick={() => void runPayout(true)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        Dry-run payout
                      </button>
                      <button
                        type="button"
                        disabled={
                          payoutLoading ||
                          (!!commission.driver_paid_out && !!commission.driver_transfer_id)
                        }
                        onClick={() => void runPayout(false)}
                        className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {payoutLoading ? "…" : "Payer chauffeur (Stripe)"}
                      </button>
                    </div>
                  ) : null}

                  {payoutResult ? (
                    <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-green-300">
                      {JSON.stringify(payoutResult, null, 2)}
                    </pre>
                  ) : null}
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">Timeline taxi_events</h2>
                {events.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">Aucun événement.</p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                      >
                        <div className="font-medium">{ev.event_type}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(ev.created_at).toLocaleString()}
                          {ev.old_status || ev.new_status
                            ? ` · ${ev.old_status ?? "?"} → ${ev.new_status ?? "?"}`
                            : ""}
                        </div>
                        {ev.description ? (
                          <div className="mt-1 text-slate-600">{ev.description}</div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {canManage ? (
                <AdminTaxiCancelRefundPanel
                  defaultRideId={rideId}
                  onCompleted={() => void load()}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </AdminGate>
  );
}
