"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canViewSellers } from "@/lib/adminAccess";

type SellerPayoutRow = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  gross_amount_cents?: number | null;
  platform_fee_cents?: number | null;
  seller_net_amount_cents?: number | null;
  currency?: string;
  status?: string;
  stripe_transfer_id?: string | null;
  payout_live_enabled?: boolean;
  sellers?: { business_name?: string | null } | null;
  updated_at?: string;
};

type DriverPayoutRow = {
  id: string;
  marketplace_delivery_job_id: string;
  seller_order_id: string;
  driver_id: string;
  driver_earning_cents?: number | null;
  bonus_cents?: number | null;
  total_driver_payout_cents?: number | null;
  currency?: string;
  status?: string;
  stripe_transfer_id?: string | null;
  payout_live_enabled?: boolean;
  updated_at?: string;
};

function formatMoney(cents: number | null | undefined, currency = "USD") {
  return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency}`;
}

export default function AdminMarketplacePayoutsPage() {
  const [sellerPayouts, setSellerPayouts] = useState<SellerPayoutRow[]>([]);
  const [driverPayouts, setDriverPayouts] = useState<DriverPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [platformFlag, setPlatformFlag] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [simulateJobId, setSimulateJobId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanView(canViewSellers(session?.role ?? null));
    const res = await adminFetch("/api/admin/marketplace-payouts");
    const body = await res.json().catch(() => ({}));
    setSellerPayouts(body.seller_payouts ?? []);
    setDriverPayouts(body.driver_payouts ?? []);
    setPlatformFlag(body.payout_live_enabled === true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(payload: Record<string, unknown>) {
    setActionMsg(null);
    const res = await adminFetch("/api/admin/marketplace-payouts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      setActionMsg(body.error ?? "Action failed");
      return;
    }
    setActionMsg(`${payload.action} OK`);
    await load();
  }

  return (
    <AdminGate requiredPermission="users.sellers.read">
      <div style={{ padding: 24, color: "#E2E8F0" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Marketplace Payouts</h1>
        <p style={{ color: "#94A3B8", marginBottom: 20 }}>
          Seller and driver payout ledgers — prepared only, no live Stripe transfers (
          MARKETPLACE_PAYOUTS_LIVE_ENABLED={String(platformFlag)}).
        </p>

        {actionMsg ? (
          <p style={{ marginBottom: 12, color: actionMsg.endsWith("OK") ? "#86EFAC" : "#FCA5A5" }}>
            {actionMsg}
          </p>
        ) : null}

        {!canView ? (
          <p>Read-only access required.</p>
        ) : loading ? (
          <p>Loading…</p>
        ) : (
          <>
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, marginBottom: 12 }}>Seller payouts</h2>
              {sellerPayouts.length === 0 ? (
                <p style={{ color: "#94A3B8" }}>No seller payouts yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {sellerPayouts.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        border: "1px solid #334155",
                        borderRadius: 12,
                        padding: 16,
                        background: "#0B1220",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <strong>{row.sellers?.business_name ?? "Seller"}</strong>
                          <div style={{ color: "#94A3B8", fontSize: 13 }}>
                            {row.seller_order_id} · {row.status ?? "—"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                          Net {formatMoney(row.seller_net_amount_cents, row.currency)}
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 13, display: "grid", gap: 4 }}>
                        <div>
                          Gross {formatMoney(row.gross_amount_cents, row.currency)} · Fee{" "}
                          {formatMoney(row.platform_fee_cents, row.currency)}
                        </div>
                        <div style={{ color: "#64748B" }}>
                          stripe_transfer_id={row.stripe_transfer_id ?? "—"} ·
                          payout_live_enabled={String(row.payout_live_enabled ?? false)}
                        </div>
                      </div>
                      {row.status === "pending" ? (
                        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "approve",
                                payout_type: "seller",
                                payout_id: row.id,
                              })
                            }
                            style={btnStyle}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "cancel",
                                payout_type: "seller",
                                payout_id: row.id,
                              })
                            }
                            style={btnSecondary}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "simulate",
                                seller_payout_id: row.id,
                              })
                            }
                            style={btnSecondary}
                          >
                            Simulate
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 style={{ fontSize: 20, marginBottom: 12 }}>Driver payouts</h2>
              {driverPayouts.length === 0 ? (
                <p style={{ color: "#94A3B8" }}>No driver payouts yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {driverPayouts.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        border: "1px solid #334155",
                        borderRadius: 12,
                        padding: 16,
                        background: "#0B1220",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div>
                          <strong>Driver {row.driver_id.slice(0, 8)}…</strong>
                          <div style={{ color: "#94A3B8", fontSize: 13 }}>
                            {row.seller_order_id} · {row.status ?? "—"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                          {formatMoney(row.total_driver_payout_cents, row.currency)}
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 13, display: "grid", gap: 4 }}>
                        <div>
                          Earning {formatMoney(row.driver_earning_cents, row.currency)} · Bonus{" "}
                          {formatMoney(row.bonus_cents, row.currency)}
                        </div>
                        <div style={{ color: "#64748B" }}>
                          job={row.marketplace_delivery_job_id} · stripe_transfer_id=
                          {row.stripe_transfer_id ?? "—"}
                        </div>
                      </div>
                      {row.status === "pending" ? (
                        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "approve",
                                payout_type: "driver",
                                payout_id: row.id,
                              })
                            }
                            style={btnStyle}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "cancel",
                                payout_type: "driver",
                                payout_id: row.id,
                              })
                            }
                            style={btnSecondary}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction({
                                action: "simulate",
                                driver_payout_id: row.id,
                              })
                            }
                            style={btnSecondary}
                          >
                            Simulate
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #334155" }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>Simulate delivered job → driver payout</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={simulateJobId}
                  onChange={(e) => setSimulateJobId(e.target.value)}
                  placeholder="marketplace_delivery_job_id"
                  style={{
                    flex: 1,
                    minWidth: 280,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #334155",
                    background: "#0B1220",
                    color: "#E2E8F0",
                  }}
                />
                <button
                  type="button"
                  disabled={!simulateJobId.trim() || platformFlag}
                  title={
                    platformFlag
                      ? "Live payout flag must stay OFF in Phase 13"
                      : "Mark job delivered and prepare driver payout"
                  }
                  onClick={() =>
                    void runAction({
                      action: "simulate",
                      marketplace_delivery_job_id: simulateJobId.trim(),
                    }).then(() => setSimulateJobId(""))
                  }
                  style={btnStyle}
                >
                  Simulate delivered
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminGate>
  );
}

const btnStyle = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#1E293B",
  color: "#E2E8F0",
  cursor: "pointer",
  fontSize: 13,
} as const;

const btnSecondary = {
  ...btnStyle,
  background: "#0F172A",
} as const;
