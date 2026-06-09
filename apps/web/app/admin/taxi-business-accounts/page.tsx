"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiBusiness } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  billing_email?: string | null;
  taxi_business_members?: { id: string; user_id: string; role: string; active: boolean }[];
  taxi_business_ride_policies?: {
    max_ride_cents?: number | null;
    max_daily_cents?: number | null;
    requires_manager_approval?: boolean | null;
  }[];
  taxi_business_billing_events?: {
    id: string;
    amount_cents: number;
    event_type: string;
    created_at: string;
  }[];
};

export default function AdminTaxiBusinessAccountsPage() {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [name, setName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiBusiness(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-business-accounts");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Load failed");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit || !name.trim()) return;
    const res = await adminFetch("/api/admin/taxi-business-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), billing_email: billingEmail.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Create failed");
      return;
    }
    setName("");
    setBillingEmail("");
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_business.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Business Accounts</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {canEdit ? (
          <form onSubmit={createAccount} style={{ marginBottom: 24, display: "flex", gap: 8 }}>
            <input
              placeholder="Company name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              placeholder="Billing email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
            />
            <button type="submit">Create account</button>
          </form>
        ) : null}
        {loading ? <p>Loading…</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Members</th>
              <th align="left">Policy</th>
              <th align="left">Recent spend events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>
                  {row.name} ({row.slug}) {row.active ? "" : "• inactive"}
                </td>
                <td>{row.taxi_business_members?.length ?? 0}</td>
                <td>
                  max ride:{" "}
                  {row.taxi_business_ride_policies?.[0]?.max_ride_cents ?? "—"} / day:{" "}
                  {row.taxi_business_ride_policies?.[0]?.max_daily_cents ?? "—"}
                </td>
                <td>{row.taxi_business_billing_events?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AdminGate>
  );
}
