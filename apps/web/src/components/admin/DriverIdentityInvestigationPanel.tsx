"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { formatIdentityDateTime } from "@/lib/driverIdentityDisplay";
import {
  globalTrustBandBadgeClass,
  type GlobalTrustBand,
} from "@/lib/driverIdentityTrustScore";

type InvestigationSectionId =
  | "driver-history"
  | "security-history"
  | "geography"
  | "trust-score"
  | "ai-insight"
  | "view-audit";

type SectionState = {
  loading: boolean;
  data: unknown;
  error: string | null;
  opened: boolean;
};

type Props = {
  checkId: string;
  enabled: boolean;
};

const SECTIONS: Array<{
  id: InvestigationSectionId;
  title: string;
  subtitle: string;
  autoLoad?: boolean;
}> = [
  {
    id: "trust-score",
    title: "Score de confiance global",
    subtitle: "Score sur 100 basé sur ancienneté, activité, incidents et comportement",
    autoLoad: true,
  },
  {
    id: "driver-history",
    title: "Historique du chauffeur",
    subtitle: "Courses, acceptation, annulations, note, suspensions et incidents",
  },
  {
    id: "security-history",
    title: "Historique sécurité",
    subtitle: "Téléphone, appareil, IP, zone, banque, permis et véhicule",
  },
  {
    id: "geography",
    title: "Carte géographique",
    subtitle: "Dernières positions connues — pas de suivi temps réel",
  },
  {
    id: "ai-insight",
    title: "Analyse MMD AI",
    subtitle: "Assistance lecture seule — le Super Admin décide",
  },
  {
    id: "view-audit",
    title: "Audit consultations",
    subtitle: "Qui a consulté ce dossier, quand et depuis quelle IP",
  },
];

function pct(value: unknown): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${Math.round(num * 100)}%`;
}

function num(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function InvestigationSectionCard({
  title,
  subtitle,
  open,
  onToggle,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <span className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
          {open ? "Masquer" : "Afficher"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Chargement…</p>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            children
          )}
        </div>
      ) : null}
    </section>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderSectionContent(section: InvestigationSectionId, data: unknown) {
  const record = asRecord(data);

  switch (section) {
    case "driver-history":
      return (
        <MetricGrid
          items={[
            { label: "Courses totales", value: num(record.total_trips, "0") },
            { label: "Taux d'acceptation", value: pct(record.acceptance_rate) },
            { label: "Taux d'annulation", value: pct(record.cancellation_rate) },
            {
              label: "Note moyenne",
              value:
                record.average_rating == null
                  ? "—"
                  : `${Number(record.average_rating).toFixed(1)} (${num(record.rating_count, "0")} avis)`,
            },
            { label: "Ancienneté", value: num(record.seniority_label) },
            { label: "Suspensions", value: num(record.suspension_count, "0") },
            {
              label: "Vérifications précédentes",
              value: num(record.previous_verifications, "0"),
            },
            { label: "Incidents signalés", value: num(record.reported_incidents, "0") },
            { label: "Incidents ouverts", value: num(record.open_incidents, "0") },
          ]}
        />
      );

    case "security-history": {
      const changes = asArray(record.changes);
      if (changes.length === 0) {
        return (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Aucun changement de sécurité enregistré.
          </p>
        );
      }
      return (
        <div className="space-y-2">
          {changes.map((entry, index) => {
            const row = asRecord(entry);
            return (
              <div
                key={`${row.at}-${index}`}
                className="rounded-xl border border-slate-100 px-4 py-3 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {num(row.label)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {formatIdentityDateTime(String(row.at ?? ""))}
                  </div>
                </div>
                <p className="mt-1 break-all text-sm text-slate-600 dark:text-slate-300">
                  {num(row.value)}
                </p>
              </div>
            );
          })}
        </div>
      );
    }

    case "geography": {
      const lastPosition = asRecord(record.last_position);
      return (
        <div className="space-y-4">
          <MetricGrid
            items={[
              { label: "Ville", value: num(record.city) },
              { label: "Pays", value: num(record.country) },
              { label: "Zone", value: num(record.zone) },
            ]}
          />
          {lastPosition.lat != null && lastPosition.lng != null ? (
            <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Dernière position : {num(lastPosition.lat)}, {num(lastPosition.lng)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {formatIdentityDateTime(String(lastPosition.updated_at ?? ""))}
              </p>
              {typeof lastPosition.maps_url === "string" ? (
                <a
                  href={lastPosition.maps_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400"
                >
                  Ouvrir sur OpenStreetMap
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Aucune position récente enregistrée.
            </p>
          )}
        </div>
      );
    }

    case "trust-score": {
      const band = String(record.band ?? "average") as GlobalTrustBand;
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-3xl font-bold text-slate-900 dark:text-slate-50">
              {num(record.score, "0")} / 100
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${globalTrustBandBadgeClass(band)}`}
            >
              {num(record.label)}
            </span>
          </div>
          <div className="space-y-2">
            {asArray(record.factors).map((factor, index) => {
              const row = asRecord(factor);
              const impact = Number(row.impact ?? 0);
              return (
                <div
                  key={`${row.key}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <span className="text-slate-700 dark:text-slate-200">{num(row.label)}</span>
                  <span
                    className={
                      impact >= 0
                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                        : "font-semibold text-red-600 dark:text-red-400"
                    }
                  >
                    {impact >= 0 ? `+${impact}` : impact}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "ai-insight":
      return (
        <div className="space-y-4">
          <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
            {num(record.summary)}
          </p>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Pourquoi le risque peut être élevé
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
              {asArray(record.riskExplanation).map((line, index) => (
                <li key={index}>{String(line)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Éléments inhabituels
            </h4>
            {asArray(record.unusualSignals).length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Aucun signal notable.</p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
                {asArray(record.unusualSignals).map((line, index) => (
                  <li key={index}>{String(line)}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Vérifications recommandées
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
              {asArray(record.recommendedChecks).map((line, index) => (
                <li key={index}>{String(line)}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{num(record.disclaimer)}</p>
        </div>
      );

    case "view-audit": {
      const entries = asArray(record.entries);
      if (entries.length === 0) {
        return (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Aucune consultation enregistrée pour ce dossier.
          </p>
        );
      }
      return (
        <div className="space-y-2">
          {entries.map((entry, index) => {
            const row = asRecord(entry);
            return (
              <div
                key={String(row.id ?? index)}
                className="rounded-xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {num(row.action)}
                    {row.section ? ` · ${num(row.section)}` : ""}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatIdentityDateTime(String(row.created_at ?? ""))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Utilisateur {num(row.staff_user_id)} · IP {num(row.ip_address, "n/a")}
                </p>
              </div>
            );
          })}
        </div>
      );
    }

    default:
      return null;
  }
}

export default function DriverIdentityInvestigationPanel({ checkId, enabled }: Props) {
  const [exportBusy, setExportBusy] = useState<"json" | "pdf" | null>(null);
  const [sections, setSections] = useState<Record<InvestigationSectionId, SectionState>>(() =>
    Object.fromEntries(
      SECTIONS.map((section) => [
        section.id,
        { loading: false, data: null, error: null, opened: Boolean(section.autoLoad) },
      ]),
    ) as Record<InvestigationSectionId, SectionState>,
  );

  const loadSection = useCallback(
    async (sectionId: InvestigationSectionId) => {
      setSections((current) => ({
        ...current,
        [sectionId]: {
          ...current[sectionId],
          loading: true,
          error: null,
        },
      }));

      try {
        const res = await adminFetch(
          `/api/admin/driver-identity/checks/${checkId}/investigation?section=${sectionId}`,
        );
        const body = await res.json();
        if (!res.ok || !body.ok) {
          throw new Error(typeof body.error === "string" ? body.error : "load_failed");
        }

        setSections((current) => ({
          ...current,
          [sectionId]: {
            ...current[sectionId],
            loading: false,
            data: body.data,
            error: null,
          },
        }));
      } catch (error) {
        setSections((current) => ({
          ...current,
          [sectionId]: {
            ...current[sectionId],
            loading: false,
            error: error instanceof Error ? error.message : "load_failed",
          },
        }));
      }
    },
    [checkId],
  );

  const toggleSection = useCallback(
    (sectionId: InvestigationSectionId) => {
      setSections((current) => {
        const nextOpen = !current[sectionId].opened;
        const shouldLoad =
          nextOpen && current[sectionId].data == null && !current[sectionId].loading;
        if (shouldLoad) {
          void loadSection(sectionId);
        }
        return {
          ...current,
          [sectionId]: {
            ...current[sectionId],
            opened: nextOpen,
          },
        };
      });
    },
    [loadSection],
  );

  useEffect(() => {
    if (!enabled || !checkId) return;

    setSections(
      Object.fromEntries(
        SECTIONS.map((section) => [
          section.id,
          { loading: false, data: null, error: null, opened: Boolean(section.autoLoad) },
        ]),
      ) as Record<InvestigationSectionId, SectionState>,
    );

    for (const section of SECTIONS) {
      if (section.autoLoad) {
        void loadSection(section.id);
      }
    }
  }, [checkId, enabled, loadSection]);

  const handleExport = useCallback(
    async (format: "json" | "pdf") => {
      setExportBusy(format);
      try {
        const url = `/api/admin/driver-identity/checks/${checkId}/export?format=${format}`;
        if (format === "pdf") {
          const res = await adminFetch(url);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(typeof body.error === "string" ? body.error : "export_failed");
          }
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = `driver-identity-${checkId.slice(0, 8)}.pdf`;
          anchor.click();
          URL.revokeObjectURL(objectUrl);
          return;
        }

        const res = await adminFetch(url);
        const body = await res.json();
        if (!res.ok || !body.ok) {
          throw new Error(typeof body.error === "string" ? body.error : "export_failed");
        }

        const blob = new Blob([JSON.stringify(body.export, null, 2)], {
          type: "application/json",
        });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `driver-identity-${checkId.slice(0, 8)}.json`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      } finally {
        setExportBusy(null);
      }
    },
    [checkId],
  );

  const trustScoreData = useMemo(
    () => asRecord(sections["trust-score"].data),
    [sections],
  );

  if (!enabled || !checkId) return null;

  return (
    <section
      id="driver-identity-investigation"
      className="space-y-4 rounded-3xl border border-indigo-200 bg-gradient-to-b from-indigo-50/80 to-white p-5 shadow-sm dark:border-indigo-900 dark:from-indigo-950/30 dark:to-slate-900"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            Investigation complète
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-50">
            Centre d&apos;opérations international
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Historique chauffeur, sécurité, géographie, score de confiance et analyse IA —
            chargement différé pour rester sous 500 ms par section.
          </p>
          {trustScoreData.score != null ? (
            <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              Confiance globale : {num(trustScoreData.score)} / 100 — {num(trustScoreData.label)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exportBusy !== null}
            onClick={() => void handleExport("json")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {exportBusy === "json" ? "Export…" : "Export JSON"}
          </button>
          <button
            type="button"
            disabled={exportBusy !== null}
            onClick={() => void handleExport("pdf")}
            className="rounded-xl border border-indigo-200 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 dark:border-indigo-700"
          >
            {exportBusy === "pdf" ? "Export…" : "Export PDF"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const state = sections[section.id];
          return (
            <InvestigationSectionCard
              key={section.id}
              title={section.title}
              subtitle={section.subtitle}
              open={state.opened}
              loading={state.loading}
              error={state.error}
              onToggle={() => toggleSection(section.id)}
            >
              {renderSectionContent(section.id, state.data)}
            </InvestigationSectionCard>
          );
        })}
      </div>
    </section>
  );
}
