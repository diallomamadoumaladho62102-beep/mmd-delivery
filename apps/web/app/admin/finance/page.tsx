"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import {
  canExportFinance,
  canReadFinance,
  canCreateFinanceAdjustments,
  canManageFinancePeriods,
} from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { FINANCE_MODULES, type FinanceModule } from "@/lib/finance/financeTypes";

const LABELS: Record<FinanceModule, string> = {
  overview: "Vue générale",
  treasury: "Trésorerie",
  revenue: "Revenus",
  expenses: "Dépenses",
  commissions: "Commissions",
  payments: "Paiements",
  refunds: "Remboursements",
  payouts: "Payouts",
  partners: "Partenaires",
  clients: "Clients",
  mmd_credit: "Crédit MMD",
  cashback: "Cashback",
  subscriptions: "Abonnements",
  taxes: "Taxes",
  reconciliation: "Rapprochements",
  settlements: "Settlements",
  disputes: "Litiges",
  adjustments: "Ajustements",
  ledger: "Grand livre",
  periods: "Périodes",
  reports: "Rapports",
  audit: "Audit",
};

function money(cents: unknown): string {
  const n = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function FinanceInner() {
  const [canRead, setCanRead] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canAdjust, setCanAdjust] = useState(false);
  const [canPeriods, setCanPeriods] = useState(false);
  const [module, setModule] = useState<FinanceModule>("overview");
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [accounts, setAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [periods, setPeriods] = useState<Array<Record<string, unknown>>>([]);
  const [adjustments, setAdjustments] = useState<Array<Record<string, unknown>>>([]);
  const [disputes, setDisputes] = useState<Array<Record<string, unknown>>>([]);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const viewForModule = (m: FinanceModule): string => {
    if (m === "overview" || m === "treasury" || m === "revenue" || m === "expenses") {
      return "overview";
    }
    if (m === "ledger" || m === "reports") return "ledger";
    if (m === "payments" || m === "refunds") return "events";
    if (m === "periods") return "periods";
    if (m === "adjustments") return "adjustments";
    if (m === "disputes") return "disputes";
    if (m === "reconciliation" || m === "settlements") return "reconciliation";
    if (m === "audit") return "audit";
    return "overview";
  };

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    const view = viewForModule(module);
    const res = await adminFetch(`/api/admin/finance?view=${view}&limit=80`);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setLoading(false);
    if (!res.ok || body.ok === false) {
      setError(String(body.error ?? "Chargement impossible"));
      return;
    }
    if (body.dashboard) setDashboard(body.dashboard as Record<string, unknown>);
    if (body.entries) setEntries(body.entries as Array<Record<string, unknown>>);
    if (body.events) setEvents(body.events as Array<Record<string, unknown>>);
    if (body.accounts) setAccounts(body.accounts as Array<Record<string, unknown>>);
    if (body.periods) setPeriods(body.periods as Array<Record<string, unknown>>);
    if (body.adjustments) setAdjustments(body.adjustments as Array<Record<string, unknown>>);
    if (body.disputes) setDisputes(body.disputes as Array<Record<string, unknown>>);
    if (body.runs) setRuns(body.runs as Array<Record<string, unknown>>);
    if (body.audits) setAudits(body.audits as Array<Record<string, unknown>>);
  }, [canRead, module]);

  useEffect(() => {
    void (async () => {
      const session = await resolveBrowserStaffSession();
      const role = session?.role ?? null;
      setCanRead(canReadFinance(role));
      setCanExport(canExportFinance(role));
      setCanAdjust(canCreateFinanceAdjustments(role));
      setCanPeriods(canManageFinancePeriods(role));
    })();
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const runAction = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      const reason = window.prompt("Motif (audit)")?.trim();
      if (!reason) return;
      const res = await adminFetch("/api/admin/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, ...extra }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.ok === false) {
        setError(String(body.error ?? "Action impossible"));
        return;
      }
      setNotice(`Action ${action} OK`);
      await load();
    },
    [load]
  );

  const exportJournal = useCallback(async () => {
    if (!canExport) return;
    const res = await adminFetch("/api/admin/finance/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "csv", limit: 500 }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setError(String(body.error ?? "Export impossible"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mmd-finance-journal.csv";
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Export CSV téléchargé.");
  }, [canExport]);

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        Permission <code>finance.read</code> requise.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Centre Financier</h1>
        <p className="mt-1 text-sm text-slate-600">
          Consolidation des flux monétaires — lecture des moteurs existants, grand livre
          double entrée, rapprochements et périodes.
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

      <nav className="flex flex-wrap gap-1" aria-label="Modules finance">
        {FINANCE_MODULES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModule(m)}
            className={[
              "rounded-lg px-2.5 py-1.5 text-xs font-medium",
              module === m
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            {LABELS[m]}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "…" : "Actualiser"}
        </button>
        {canPeriods && (
          <>
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={() => void runAction("process_pending")}
            >
              Traiter événements
            </button>
            <button
              type="button"
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={() => void runAction("refresh_balances")}
            >
              Rafraîchir soldes
            </button>
          </>
        )}
        {canExport && (
          <button
            type="button"
            className="rounded-xl border px-3 py-2 text-sm"
            onClick={() => void exportJournal()}
          >
            Export journal CSV
          </button>
        )}
      </div>

      {(module === "overview" ||
        module === "treasury" ||
        module === "revenue" ||
        module === "expenses") &&
        dashboard && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Encaissements jour", money(dashboard.collections_today_cents)],
              ["Encaissements période", money(dashboard.collections_month_cents)],
              ["Revenus MMD", money(dashboard.mmd_revenue_cents)],
              ["Frais paiement", money(dashboard.payment_fees_cents)],
              ["Événements pending", String(dashboard.pending_source_events ?? 0)],
              ["Événements failed", String(dashboard.failed_source_events ?? 0)],
              ["Manual review", String(dashboard.manual_review_events ?? 0)],
              ["Périodes ouvertes", String(dashboard.open_periods ?? 0)],
              ["Litiges ouverts", String(dashboard.open_disputes ?? 0)],
            ].map(([label, value]) => (
              <article
                key={label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm text-slate-600">{label}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
              </article>
            ))}
          </section>
        )}

      {(module === "ledger" || module === "reports") && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Journal</h2>
          <ul className="mt-3 divide-y text-sm">
            {entries.map((e) => (
              <li key={String(e.id)} className="py-2">
                <strong>{String(e.accounting_date)}</strong> · {String(e.event_type)} ·{" "}
                {String(e.vertical ?? "—")} · {String(e.status)} ·{" "}
                {String(e.description ?? "")}
              </li>
            ))}
            {entries.length === 0 && (
              <li className="py-2 text-slate-500">Aucune écriture.</li>
            )}
          </ul>
        </section>
      )}

      {(module === "payments" || module === "refunds") && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Événements source</h2>
          <ul className="mt-3 divide-y text-sm">
            {events.map((e) => (
              <li key={String(e.id)} className="py-2">
                {String(e.event_type)} · {String(e.status)} · {String(e.source_type)}/
                {String(e.source_id)}
                {e.last_error ? (
                  <span className="text-red-600"> — {String(e.last_error)}</span>
                ) : null}
              </li>
            ))}
            {events.length === 0 && (
              <li className="py-2 text-slate-500">Aucun événement.</li>
            )}
          </ul>
        </section>
      )}

      {module === "periods" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Périodes comptables</h2>
          <ul className="mt-3 divide-y text-sm">
            {periods.map((p) => (
              <li key={String(p.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {String(p.code)} · {String(p.starts_on)} → {String(p.ends_on)} ·{" "}
                  {String(p.status)}
                </span>
                {canPeriods && p.status === "open" && (
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs"
                    onClick={() =>
                      void runAction("close_period", { period_id: p.id })
                    }
                  >
                    Clôturer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {module === "adjustments" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Ajustements</h2>
          <ul className="mt-3 divide-y text-sm">
            {adjustments.map((a) => (
              <li key={String(a.id)} className="py-2">
                {String(a.adjustment_type)} · {money(a.amount_cents)} · {String(a.status)} ·{" "}
                {String(a.reason ?? "")}
              </li>
            ))}
            {adjustments.length === 0 && (
              <li className="py-2 text-slate-500">Aucun ajustement.</li>
            )}
          </ul>
        </section>
      )}

      {module === "disputes" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Litiges / chargebacks</h2>
          <ul className="mt-3 divide-y text-sm">
            {disputes.map((d) => (
              <li key={String(d.id)} className="py-2">
                {String(d.provider)} · {String(d.provider_dispute_id)} · {money(d.amount_cents)} ·{" "}
                {String(d.status)}
              </li>
            ))}
            {disputes.length === 0 && (
              <li className="py-2 text-slate-500">Aucun litige.</li>
            )}
          </ul>
        </section>
      )}

      {(module === "reconciliation" || module === "settlements") && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Rapprochements</h2>
          <ul className="mt-3 divide-y text-sm">
            {runs.map((r) => (
              <li key={String(r.id)} className="py-2">
                {String(r.provider ?? "—")} · {String(r.status)} · {String(r.started_at ?? "")}
              </li>
            ))}
            {runs.length === 0 && (
              <li className="py-2 text-slate-500">Aucun run de rapprochement.</li>
            )}
          </ul>
        </section>
      )}

      {module === "audit" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Audit finance</h2>
          <ul className="mt-3 divide-y text-sm">
            {audits.map((a) => (
              <li key={String(a.id)} className="py-2">
                {String(a.created_at ?? "")} · {String(a.action)} · {String(a.entity_type ?? "")}
              </li>
            ))}
            {audits.length === 0 && (
              <li className="py-2 text-slate-500">Aucun événement d’audit.</li>
            )}
          </ul>
        </section>
      )}

      {(module === "partners" ||
        module === "clients" ||
        module === "mmd_credit" ||
        module === "cashback" ||
        module === "subscriptions" ||
        module === "taxes" ||
        module === "commissions" ||
        module === "payouts") && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            Module <strong>{LABELS[module]}</strong> : soldes dérivés des écritures consolidées et
            des ledgers opérationnels (pas de modification directe de solde). Filtrer le journal /
            les événements source pour le détail.
            {canAdjust ? " Ajustements sensibles → double approbation." : ""}
          </div>
          {module === "subscriptions" && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm">
              Reconnaissance du revenu : cron <code>/api/cron/recognize-finance-revenue</code> sur
              <code> finance_revenue_schedules</code> (mensuel / annuel straight-line).
            </div>
          )}
        </section>
      )}

      {accounts.length > 0 && module === "overview" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Plan comptable (aperçu)</h2>
          <p className="mt-1 text-xs text-slate-500">{accounts.length} comptes configurés</p>
        </section>
      )}
    </div>
  );
}

export default function AdminFinancePage() {
  return (
    <AdminGate requiredPermission="finance.read">
      <FinanceInner />
    </AdminGate>
  );
}
