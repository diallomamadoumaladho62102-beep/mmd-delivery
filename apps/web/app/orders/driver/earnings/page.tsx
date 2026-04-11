"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type EarningsOrder = {
  id: string;
  status: OrderStatus;
  created_at: string;
  total: number | null;
  currency: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
};

type Me = {
  id: string;
  full_name: string | null;
};

type MemberRow = {
  order_id: string;
  user_id: string;
  role: string;
};

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// 💰 Estimation simple de la part chauffeur (base + miles + minutes) * % chauffeur
function computeDriverEarnings(
  distanceMiles: number | null,
  etaMinutes: number | null
): number | null {
  if (distanceMiles == null || etaMinutes == null) return null;

  const base = 3; // base de la course
  const perMile = 1.2; // montant par mile
  const perMinute = 0.25; // montant par minute

  const brut = base + distanceMiles * perMile + etaMinutes * perMinute;

  const driverShareRatio = 0.6; // 60% pour le chauffeur (ajustable plus tard)
  const net = brut * driverShareRatio;

  return Math.max(0, Math.round(net * 100) / 100); // arrondi 2 décimales
}

function currentYearUTC() {
  return new Date().getUTCFullYear();
}

type DownloadOk = {
  routeVersion?: string;
  year: number;
  driverId: string;
  file: {
    bucket: string;
    path: string;
    signedUrl: string;
    expiresInSeconds: number;
  };
};

type ApiErr = {
  error: string;
  hint?: string;
  bucket?: string;
  path?: string;
  routeVersion?: string;
};

function TaxPdfCard() {
  const years = useMemo(() => {
    const y = currentYearUTC();
    return [y, y - 1, y - 2, y - 3];
  }, []);

  const [year, setYear] = useState<number>(years[1] ?? currentYearUTC() - 1);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const token = data?.session?.access_token;
    if (!token) throw new Error("Tu dois être connecté (session access_token manquant).");
    return token;
  }

  async function callJson<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const json = (await res.json()) as any;

    if (!res.ok) {
      const errMsg = json?.error || `HTTP ${res.status}`;
      const e = new Error(errMsg) as any;
      e.payload = json;
      e.status = res.status;
      throw e;
    }

    return json as T;
  }

  async function onDownload() {
    setLoading(true);
    setMsg(null);

    try {
      const token = await getAccessToken();
      const data = await callJson<DownloadOk>(
        `/api/driver/tax/download?year=${year}`,
        token
      );

      window.open(data.file.signedUrl, "_blank", "noopener,noreferrer");
      setMsg(`✅ Download prêt (année ${year}).`);
    } catch (e: any) {
      const status = e?.status;
      const payload = e?.payload as ApiErr | undefined;

      if (status === 404) {
        setMsg(
          `⚠️ PDF pas encore généré pour ${year}. Clique “Generate PDF + Download”.`
        );
      } else {
        setMsg(`❌ ${payload?.error ?? e?.message ?? "Erreur inconnue"}`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onGenerateThenDownload() {
    setLoading(true);
    setMsg(null);

    try {
      const token = await getAccessToken();

      // 1) Generate PDF (Option 2)
      const genRes = await fetch(`/api/driver/tax/summary?year=${year}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const genJson = await genRes.json().catch(() => null);

      if (!genRes.ok) {
        throw new Error(genJson?.error || `Generate failed (HTTP ${genRes.status})`);
      }

      // 2) Download (increments download_count)
      const data = await callJson<DownloadOk>(
        `/api/driver/tax/download?year=${year}`,
        token
      );

      window.open(data.file.signedUrl, "_blank", "noopener,noreferrer");
      setMsg(`✅ Généré + download OK (année ${year}).`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "Erreur inconnue"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border rounded-xl bg-white p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tax PDF</h2>
          <p className="text-sm text-gray-600">
            Génère et télécharge ton résumé annuel (PDF) depuis le serveur.
          </p>
          <p className="text-xs text-gray-500">
            “Download” incrémente <code>download_count</code> et met à jour{" "}
            <code>last_downloaded_at</code>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Année</span>
          <select
            className="rounded-lg border px-2 py-1 text-sm bg-white"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={loading}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onDownload}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-black text-white text-sm font-medium disabled:opacity-50"
        >
          Download PDF
        </button>

        <button
          onClick={onGenerateThenDownload}
          disabled={loading}
          className="px-3 py-2 rounded-lg border bg-white text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Generate PDF + Download
        </button>
      </div>

      {msg && (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
          {msg}
        </div>
      )}
    </section>
  );
}

export default function DriverEarningsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<EarningsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        // 1) Récupérer l'utilisateur connecté
        const { data: userData, error: userError } =
          await supabase.auth.getUser();
        if (userError) {
          console.error(userError);
          if (!cancelled) {
            setErr(userError.message);
            setLoading(false);
          }
          return;
        }

        const user = userData.user;
        if (!user) {
          if (!cancelled) {
            setErr(
              "Tu dois être connecté en tant que chauffeur pour voir tes gains."
            );
            setLoading(false);
          }
          return;
        }

        const uid = user.id;

        // 2) Charger le profil (pour le nom)
        const { data: profileRow, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", uid)
          .maybeSingle();

        if (!profileError && profileRow) {
          setMe({
            id: profileRow.id,
            full_name: profileRow.full_name ?? null,
          });
        } else {
          setMe({
            id: uid,
            full_name: user.email ?? null,
          });
        }

        // 3) Récupérer les commandes où je suis driver dans order_members
        const { data: membersData, error: membersError } = await supabase
          .from("order_members")
          .select("order_id, user_id, role")
          .eq("user_id", uid)
          .eq("role", "driver");

        if (membersError) {
          console.error(membersError);
          if (!cancelled) {
            setErr(membersError.message);
            setLoading(false);
          }
          return;
        }

        const members = (membersData || []) as MemberRow[];
        const orderIds = Array.from(new Set(members.map((m) => m.order_id)));

        if (orderIds.length === 0) {
          if (!cancelled) {
            setOrders([]);
            setLoading(false);
          }
          return;
        }

        // 4) Charger les commandes livrées correspondantes dans orders
        const { data: ordersData, error: ordersError } = await supabase
          .from("orders")
          .select(
            `
            id,
            status,
            created_at,
            total,
            currency,
            distance_miles,
            eta_minutes
          `
          )
          .in("id", orderIds)
          .eq("status", "delivered")
          .order("created_at", { ascending: false });

        if (ordersError) {
          console.error(ordersError);
          if (!cancelled) {
            setErr(ordersError.message);
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setOrders((ordersData || []) as EarningsOrder[]);
          setLoading(false);
        }
      } catch (e: any) {
        console.error("Unexpected error in DriverEarningsPage.load", e);
        if (!cancelled) {
          setErr(e?.message || "Erreur inconnue lors du chargement de tes gains.");
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const currency = useMemo(() => {
    if (orders.length === 0) return "USD";
    return orders[0].currency ?? "USD";
  }, [orders]);

  const totalEarnings = useMemo(() => {
    return orders.reduce((sum, o) => {
      const e = computeDriverEarnings(o.distance_miles, o.eta_minutes);
      if (e == null) return sum;
      return sum + e;
    }, 0);
  }, [orders]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mes gains chauffeur</h1>
          <p className="text-sm text-gray-600">
            Récapitulatif des courses livrées et de ta part estimée par course.
          </p>
          {me && (
            <p className="text-xs text-gray-500 mt-1">
              Connecté en tant que{" "}
              <span className="font-medium">{me.full_name || me.id}</span>.
            </p>
          )}
        </div>

        <Link
          href="/orders/driver"
          className="px-3 py-1.5 rounded-lg border text-sm bg-white hover:bg-gray-50"
        >
          ← Retour au tableau de bord chauffeur
        </Link>
      </header>

      {/* ✅ Tax PDF UI (Option 2) */}
      <TaxPdfCard />

      {loading && <p className="text-sm text-gray-600">Chargement de tes gains…</p>}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      {!loading && !err && (
        <>
          {/* Résumé global */}
          <section className="border rounded-xl bg-white p-4 space-y-2">
            <h2 className="text-lg font-semibold">Résumé</h2>
            {orders.length === 0 ? (
              <p className="text-sm text-gray-600">
                Tu n&apos;as pas encore de course livrée enregistrée en tant que chauffeur.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-medium">Nombre de courses livrées :</span>{" "}
                  {orders.length}
                </p>
                <p className="text-sm">
                  <span className="font-medium">Gains estimés totaux :</span>{" "}
                  {totalEarnings.toFixed(2)} {currency}
                </p>
                <p className="text-xs text-gray-500">
                  Estimation basée sur la distance et le temps de chaque course.
                  La formule sera ajustée quand les règles MMD seront définitives.
                </p>
              </>
            )}
          </section>

          {/* Détail par course */}
          {orders.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Détail par course</h2>
              <div className="space-y-3">
                {orders.map((o) => {
                  const shortId = o.id.slice(0, 8);
                  const earning = computeDriverEarnings(o.distance_miles, o.eta_minutes);

                  return (
                    <article
                      key={o.id}
                      className="border rounded-xl bg-white p-4 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{"Course #" + shortId}</p>
                          <p className="text-xs text-gray-500">
                            {"Livrée le " + formatDate(o.created_at)}
                          </p>
                        </div>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Statut : livrée
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div className="space-y-1">
                          <p>
                            <span className="font-medium">Distance :</span>{" "}
                            {o.distance_miles != null
                              ? o.distance_miles.toFixed(1) + " mi"
                              : "—"}
                          </p>
                          <p>
                            <span className="font-medium">Temps estimé :</span>{" "}
                            {o.eta_minutes != null ? o.eta_minutes + " min" : "—"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p>
                            <span className="font-medium">
                              Montant total (client) :
                            </span>{" "}
                            {o.total != null
                              ? o.total.toFixed(2) + " " + (o.currency ?? "USD")
                              : "— " + (o.currency ?? "USD")}
                          </p>
                          <p>
                            <span className="font-medium">Ta part (estimée) :</span>{" "}
                            {earning != null
                              ? earning.toFixed(2) + " " + (o.currency ?? "USD")
                              : "—"}
                          </p>
                        </div>
                      </div>

                      <p className="text-[11px] text-gray-500">
                        Le détail exact du panier reste visible côté client / restaurant.
                        Ici, tu vois uniquement ton estimation de gains chauffeur.
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
