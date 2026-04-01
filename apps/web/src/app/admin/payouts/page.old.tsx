"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type OrdersSummary = {
  count: number;
  amount: number; // dollars
  currency: string;
  orderIds: string[];
};

function money(n: number, currency: string) {
  const val = Number.isFinite(n) ? n : 0;
  return `${val.toFixed(2)} ${currency}`;
}

export default function AdminPayoutsPage() {
  const [loading, setLoading] = useState(false);

  const [me, setMe] = useState<{ id: string; email?: string } | null>(null);

  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [restaurantUserId, setRestaurantUserId] = useState(
    "306ef52d-aa3c-4475-a7f3-abe0f9f6817c"
  );

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);

  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  async function refreshMeAndAdmin() {
    try {
      setErr(null);
      setAdminChecked(false);

      const { data, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const user = data.user;
      if (!user) {
        setMe(null);
        setIsAdmin(false);
        setAdminChecked(true);
        return;
      }

      setMe({ id: user.id, email: user.email ?? undefined });

      const { data: adminRow, error: adminErr } = await supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminErr) {
        console.log("admin_users select error =", adminErr);
        setIsAdmin(false);
        setAdminChecked(true);
        return;
      }

      setIsAdmin(!!adminRow);
      setAdminChecked(true);
    } catch (e: any) {
      console.log("AdminPayoutsPage init error =", e);
      setErr(e?.message ?? "Erreur init admin");
      setMe(null);
      setIsAdmin(false);
      setAdminChecked(true);
    }
  }

  async function fetchOrdersSummary(targetRestaurantUserId: string) {
    try {
      setSummaryLoading(true);
      setErr(null);
      setCopyMsg(null);

      if (!targetRestaurantUserId) {
        setSummary(null);
        return;
      }

      // ✅ only admin (sinon RLS peut bloquer)
      if (!me || !adminChecked || !isAdmin) {
        setSummary(null);
        return;
      }

      // ✅ IMPORTANT: même filtre que pay_restaurant_now
      // (si tu veux être encore plus strict “Stripe vérité”, on peut aussi exclure
      // restaurant_transfer_id/restaurant_payout_id non null)
      const { data, error } = await supabase
        .from("orders")
        .select("id, currency, restaurant_net_amount")
        .eq("restaurant_id", targetRestaurantUserId)
        .eq("status", "delivered")
        .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false");

      if (error) throw error;

      const rows = (data ?? []) as Array<{
        id: string;
        currency: string | null;
        restaurant_net_amount: number | null;
      }>;

      const currency = rows.find((r) => r.currency)?.currency ?? "USD";
      const orderIds = rows.map((r) => r.id);

      const count = rows.length;
      const amount = rows.reduce((acc, r) => {
        const v = Number(r.restaurant_net_amount ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

      setSummary({ count, amount, currency, orderIds });
    } catch (e: any) {
      console.log("fetchOrdersSummary error =", e);
      setSummary(null);
      setErr(e?.message ?? "Erreur résumé orders");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await refreshMeAndAdmin();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refreshMeAndAdmin();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchOrdersSummary(restaurantUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantUserId, me?.id, adminChecked, isAdmin]);

  const canPay = useMemo(() => {
    return !!me && adminChecked && isAdmin && !loading;
  }, [me, adminChecked, isAdmin, loading]);

  const canCopyIds = useMemo(() => {
    return !!me && adminChecked && isAdmin && !!summary && summary.orderIds.length > 0;
  }, [me, adminChecked, isAdmin, summary]);

  async function copyIds() {
    try {
      setCopyMsg(null);

      if (!summary || summary.orderIds.length === 0) {
        setCopyMsg("Aucun ID à copier.");
        return;
      }

      const text = summary.orderIds.join("\n");

      // moderne
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback vieux navigateurs
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      setCopyMsg(`IDs copiés ✅ (${summary.orderIds.length})`);
      window.setTimeout(() => setCopyMsg(null), 2500);
    } catch (e: any) {
      console.log("copyIds error =", e);
      setCopyMsg(e?.message ?? "Impossible de copier.");
    }
  }

  async function payNow() {
    try {
      setLoading(true);
      setErr(null);
      setResult(null);
      setCopyMsg(null);

      if (!me) throw new Error("Non connecté");
      if (!adminChecked) throw new Error("Vérification admin en cours...");
      if (!isAdmin) throw new Error("Forbidden (admin only)");
      if (!restaurantUserId) throw new Error("Missing restaurant_user_id");

      // ✅ dernier check: si summary=0 => on bloque
      if (!summary || summary.count === 0 || summary.amount <= 0) {
        throw new Error("Aucune order unpaid à payer (résumé = 0).");
      }

      const confirmText = `Tu vas payer ${money(
        summary.amount,
        summary.currency
      )} pour ${summary.count} commande(s).\n\nIDs:\n${summary.orderIds
        .slice(0, 10)
        .join("\n")}${summary.orderIds.length > 10 ? "\n..." : ""}\n\nContinuer ?`;

      const ok = window.confirm(confirmText);
      if (!ok) return;

      const { data, error } = await supabase.functions.invoke(
        "pay_restaurant_now",
        {
          body: { restaurant_user_id: restaurantUserId },
        }
      );

      if (error) {
        const edgeBody = (error as any)?.context?.body;
        const edgeStatus = (error as any)?.context?.status;

        const msg =
          edgeBody
            ? typeof edgeBody === "string"
              ? edgeBody
              : JSON.stringify(edgeBody)
            : error.message;

        throw new Error(edgeStatus ? `${edgeStatus}: ${msg}` : msg);
      }

      setResult(data);

      // ✅ après paiement, refresh résumé (devrait retomber à 0)
      await fetchOrdersSummary(restaurantUserId);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur payout");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Admin · Payout Restaurant</h1>

      <div
        style={{
          marginTop: 10,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <div>
          <b>Moi:</b> {me ? `${me.email ?? ""} (${me.id})` : "Non connecté"}
        </div>

        <div style={{ marginTop: 6 }}>
          <b>Admin:</b>{" "}
          {!adminChecked ? "⏳ vérification..." : isAdmin ? "✅ Oui" : "❌ Non"}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 700 }}>restaurant_user_id</label>

        <input
          value={restaurantUserId}
          onChange={(e) => setRestaurantUserId(e.target.value)}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
            marginTop: 6,
            fontFamily: "monospace",
          }}
        />
      </div>

      {/* ✅ Résumé + IDs */}
      <div
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Résumé (orders unpaid → payout)
        </div>

        {!me || !adminChecked ? (
          <div style={{ color: "#6b7280" }}>Connexion / vérification…</div>
        ) : !isAdmin ? (
          <div style={{ color: "crimson", fontWeight: 700 }}>
            Admin requis pour voir le résumé (RLS).
          </div>
        ) : summaryLoading ? (
          <div style={{ color: "#6b7280" }}>Chargement résumé…</div>
        ) : summary ? (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "#6b7280", fontSize: 12 }}>Unpaid orders</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{summary.count}</div>
              </div>

              <div>
                <div style={{ color: "#6b7280", fontSize: 12 }}>Total à payer</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>
                  {money(summary.amount, summary.currency)}
                </div>
              </div>

              <div>
                <div style={{ color: "#6b7280", fontSize: 12 }}>Currency</div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{summary.currency}</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Order IDs qui vont être payées
              </div>

              {summary.orderIds.length === 0 ? (
                <div style={{ color: "#6b7280" }}>Aucune.</div>
              ) : (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 10,
                    maxHeight: 220,
                    overflow: "auto",
                    fontFamily: "monospace",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {summary.orderIds.join("\n")}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ color: "#6b7280" }}>Aucun résumé (ou pas d’orders non payées).</div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <button
            onClick={() => void fetchOrdersSummary(restaurantUserId)}
            disabled={!me || !adminChecked || !isAdmin || summaryLoading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#fff",
              fontWeight: 800,
              cursor:
                !me || !adminChecked || !isAdmin || summaryLoading
                  ? "not-allowed"
                  : "pointer",
              opacity: !me || !adminChecked || !isAdmin || summaryLoading ? 0.6 : 1,
            }}
          >
            {summaryLoading ? "Rafraîchit..." : "Rafraîchir résumé"}
          </button>

          <button
            onClick={() => void copyIds()}
            disabled={!canCopyIds}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #111",
              background: canCopyIds ? "#111" : "#999",
              color: "white",
              fontWeight: 800,
              cursor: canCopyIds ? "pointer" : "not-allowed",
              opacity: canCopyIds ? 1 : 0.7,
            }}
          >
            Copier les IDs
          </button>

          {copyMsg ? (
            <span style={{ alignSelf: "center", color: "#065f46", fontWeight: 800 }}>
              {copyMsg}
            </span>
          ) : null}
        </div>
      </div>

      <button
        onClick={payNow}
        disabled={!canPay}
        style={{
          marginTop: 14,
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid #111",
          background: canPay ? "#111" : "#999",
          color: "white",
          fontWeight: 800,
          cursor: canPay ? "pointer" : "not-allowed",
          opacity: loading ? 0.8 : 1,
        }}
      >
        {loading ? "Paiement..." : "Payer maintenant (Stripe Transfer)"}
      </button>

      {err ? (
        <pre style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          {err}
        </pre>
      ) : null}

      {result ? (
        <pre
          style={{
            marginTop: 12,
            background: "#f6f6f6",
            padding: 12,
            borderRadius: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
