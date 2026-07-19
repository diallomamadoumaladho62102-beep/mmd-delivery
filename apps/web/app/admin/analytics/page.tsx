"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import {
  canExportAnalytics,
  canFinanceAnalytics,
  canManageAnalytics,
  canReadAnalytics,
} from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import {
  ANALYTICS_MODULES,
  type AnalyticsCard,
  type AnalyticsModule,
} from "@/lib/analytics/analyticsTypes";

const MODULE_LABELS: Record<AnalyticsModule, string> = {
  global: "Global",
  food: "Food",
  delivery: "Delivery",
  taxi: "Taxi",
  marketplace: "Marketplace",
  loyalty: "Fidélité",
  mmd_plus: "MMD+",
  marketing: "Marketing",
  finance: "Finance",
  drivers: "Chauffeurs",
  restaurants: "Restaurants",
  sellers: "Vendeurs",
  fraud: "Fraude",
};

function formatValue(card: AnalyticsCard): string {
  const v = card.value;
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (card.format === "currency_cents") {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "USD",
    }).format(n / 100);
  }
  if (card.format === "percent") return `${n}%`;
  if (card.format === "duration_sec") {
    const m = Math.round(n / 60);
    return `${m} min`;
  }
  if (typeof v === "number" || Number.isFinite(n)) {
    return new Intl.NumberFormat("fr-FR").format(n);
  }
  return String(v);
}

function AnalyticsInner() {
  const [canRead, setCanRead] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canFinance, setCanFinance] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [module, setModule] = useState<AnalyticsModule>("global");
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 29 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [cards, setCards] = useState<AnalyticsCard[]>([]);
  const [refreshSeconds, setRefreshSeconds] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");

  const availableModules = useMemo(() => {
    return ANALYTICS_MODULES.filter((m) => {
      if (m === "finance") return canFinance || canRead;
      return true;
    });
  }, [canFinance, canRead]);

  const load = useCallback(async () => {
    if (!canRead) return;
    if (module === "finance" && !canFinance) {
      setError("Permission analytics.finance requise pour le module Finance.");
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      module,
      from,
      to,
      fresh: "0",
    });
    if (country.trim()) qs.set("country", country.trim().toUpperCase());
    if (city.trim()) qs.set("city", city.trim());

    const res = await adminFetch(`/api/admin/analytics/summary?${qs.toString()}`);
    setLoading(false);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok === false) {
      setError(String(body.error ?? "Chargement impossible"));
      return;
    }
    setCards((body.cards as AnalyticsCard[]) ?? []);
    setGeneratedAt(String(body.generated_at ?? ""));
    setSource(String(body.source ?? ""));
  }, [canRead, canFinance, module, from, to, country, city]);

  useEffect(() => {
    void (async () => {
      const session = await resolveBrowserStaffSession();
      const role = session?.role ?? null;
      setCanRead(canReadAnalytics(role));
      setCanExport(canExportAnalytics(role));
      setCanFinance(canFinanceAnalytics(role));
      setCanManage(canManageAnalytics(role));
    })();
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  useEffect(() => {
    if (!canRead || refreshSeconds < 15) return;
    const id = window.setInterval(() => {
      void load();
    }, refreshSeconds * 1000);
    return () => window.clearInterval(id);
  }, [canRead, refreshSeconds, load]);

  const exportData = useCallback(
    async (format: "csv" | "excel" | "pdf") => {
      if (!canExport) return;
      setNotice(null);
      try {
        const res = await adminFetch("/api/admin/analytics/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            module,
            format,
            from,
            to,
            country_code: country.trim() || null,
            city: city.trim() || null,
          }),
        });
        const contentType = res.headers.get("Content-Type") ?? "";
        if (!res.ok || contentType.includes("application/json")) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          setError(String(err.error ?? "Export impossible"));
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ??
          `analytics.${format === "excel" ? "xls" : format}`;
        a.click();
        URL.revokeObjectURL(url);
        setNotice(`Export ${format.toUpperCase()} téléchargé.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export impossible");
      }
    },
    [canExport, module, from, to, country, city]
  );

  const savePrefs = useCallback(async () => {
    if (!canManage) return;
    const visible = cards.filter((c) => c.visible).map((c) => c.key);
    const res = await adminFetch("/api/admin/analytics/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module,
        visible_cards: visible,
        card_order: cards.map((c) => c.key),
        refresh_seconds: refreshSeconds,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok === false) {
      setError(String(body.error ?? "Sauvegarde impossible"));
      return;
    }
    setNotice("Préférences enregistrées.");
  }, [canManage, cards, module, refreshSeconds]);

  const toggleCard = useCallback((key: string) => {
    setCards((prev) =>
      prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c))
    );
  }, []);

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Permission <code>analytics.read</code> requise.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-600">
          Centre BI — lecture seule sur les moteurs existants. Actualisation auto toutes les{" "}
          {refreshSeconds}s.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <nav className="flex flex-wrap gap-1" aria-label="Modules analytics">
        {availableModules.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModule(m)}
            className={[
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              module === m
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            {MODULE_LABELS[m]}
          </button>
        ))}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-sm">
            Du
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Au
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Pays
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder="US"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Ville
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Refresh (s)
            <input
              type="number"
              min={15}
              max={3600}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={refreshSeconds}
              onChange={(e) => setRefreshSeconds(Number(e.target.value) || 60)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Chargement…" : "Actualiser"}
          </button>
          {canExport && (
            <>
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm"
                onClick={() => void exportData("csv")}
              >
                CSV
              </button>
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm"
                onClick={() => void exportData("excel")}
              >
                Excel
              </button>
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm"
                onClick={() => void exportData("pdf")}
              >
                PDF
              </button>
            </>
          )}
          {canManage && (
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={() => void savePrefs()}
            >
              Sauver cartes
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Source {source || "—"}
          {generatedAt ? ` · ${generatedAt}` : ""}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards
          .filter((c) => c.visible)
          .map((card) => (
            <article
              key={card.key}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-600">{card.label}</p>
                {canManage && (
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-slate-700"
                    onClick={() => toggleCard(card.key)}
                    title="Masquer"
                  >
                    Masquer
                  </button>
                )}
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatValue(card)}
              </p>
            </article>
          ))}
        {cards.filter((c) => c.visible).length === 0 && (
          <p className="text-sm text-slate-500">Aucune carte visible.</p>
        )}
      </section>

      {canManage && cards.some((c) => !c.visible) && (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-800">Cartes masquées</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {cards
              .filter((c) => !c.visible)
              .map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="rounded-lg border bg-white px-2 py-1 text-xs"
                  onClick={() => toggleCard(c.key)}
                >
                  + {c.label}
                </button>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <AdminGate requiredPermission="analytics.read">
      <AnalyticsInner />
    </AdminGate>
  );
}
