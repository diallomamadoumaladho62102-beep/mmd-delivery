"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { canManageDriverIdentity, canViewDriverIdentity } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type IdentityCheck = {
  id: string;
  driver_id: string;
  status: string;
  trigger_type: string;
  reason: string | null;
  city: string | null;
  country: string | null;
  risk_score: number;
  requires_manual_review: boolean;
  created_at: string;
  submitted_at: string | null;
  driver_profile?: {
    full_name: string | null;
    phone: string | null;
    city: string | null;
    status: string | null;
    is_online: boolean | null;
  } | null;
};

export default function AdminDriverIdentityPage() {
  const [role, setRole] = useState<string | null>(null);
  const [checks, setChecks] = useState<IdentityCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      setRole(profile?.role ?? null);
    })();
  }, []);

  const canRead = canViewDriverIdentity(role as any);
  const canManage = canManageDriverIdentity(role as any);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await adminFetch(`/api/admin/driver-identity/checks?${qs.toString()}`);
      const body = await res.json();
      setChecks(body.checks ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    if (canRead) void loadChecks();
  }, [canRead, loadChecks]);

  const loadDetail = useCallback(async (checkId: string) => {
    setSelectedId(checkId);
    const res = await adminFetch(`/api/admin/driver-identity/checks/${checkId}`);
    const body = await res.json();
    setDetail(body);
  }, []);

  const review = useCallback(
    async (action: string) => {
      if (!selectedId || !canManage) return;
      setBusy(true);
      try {
        await adminFetch(`/api/admin/driver-identity/checks/${selectedId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, review_notes: reviewNotes }),
        });
        await loadDetail(selectedId);
        await loadChecks();
      } finally {
        setBusy(false);
      }
    },
    [canManage, loadChecks, loadDetail, reviewNotes, selectedId],
  );

  const statuses = useMemo(
    () => [
      "",
      "required",
      "pending",
      "submitted",
      "manual_review",
      "verified",
      "rejected",
      "expired",
    ],
    [],
  );

  if (!canRead) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Vérification identité chauffeur</h1>
        <p>Accès refusé.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Vérification identité chauffeur</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>
            Revue manuelle, selfies, historique et audit.
          </p>
        </div>
        <Link href="/admin/driver-identity/settings">Paramètres moteur de risque</Link>
      </header>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {statuses.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "Tous les statuts"}
            </option>
          ))}
        </select>
        <input
          placeholder="Rechercher chauffeur"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" onClick={() => void loadChecks()}>
          Filtrer
        </button>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section>
          <h2>Liste</h2>
          {loading ? <p>Chargement…</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {checks.map((check) => (
              <button
                key={check.id}
                type="button"
                onClick={() => void loadDetail(check.id)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  border: selectedId === check.id ? "2px solid #4f46e5" : "1px solid #e2e8f0",
                  borderRadius: 8,
                  background: "#fff",
                }}
              >
                <strong>{check.driver_profile?.full_name ?? check.driver_id}</strong>
                <div>{check.status} · {check.trigger_type}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {new Date(check.created_at).toLocaleString()} · risque {check.risk_score}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Détail</h2>
          {!detail ? <p>Sélectionnez une vérification.</p> : null}
          {detail?.check ? (
            <div style={{ display: "grid", gap: 12 }}>
              {(detail.selfie_signed_url as string) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.selfie_signed_url as string}
                  alt="Selfie chauffeur"
                  style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 8 }}
                />
              ) : (
                <p>Aucun selfie disponible.</p>
              )}
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 12 }}>
                {JSON.stringify(detail.check, null, 2)}
              </pre>
              {canManage ? (
                <>
                  <textarea
                    placeholder="Note interne"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" disabled={busy} onClick={() => void review("approve")}>
                      Approuver
                    </button>
                    <button type="button" disabled={busy} onClick={() => void review("reject")}>
                      Refuser
                    </button>
                    <button type="button" disabled={busy} onClick={() => void review("request_new_photo")}>
                      Nouvelle photo
                    </button>
                    <button type="button" disabled={busy} onClick={() => void review("suspend")}>
                      Suspendre
                    </button>
                  </div>
                </>
              ) : null}
              <h3>Historique</h3>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 12 }}>
                {JSON.stringify(detail.events ?? [], null, 2)}
              </pre>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
