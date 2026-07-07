"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  buildIdentityRiskReasonBadges,
  confidenceScoreBadgeClass,
  driverProfileStatusBadgeClass,
  driverProfileStatusLabel,
  evaluateIdentityWaitSla,
  formatIdentityDate,
  formatIdentityDateTime,
  formatIdentityTime,
  formatProcessingDuration,
  identityDecisionActionLabel,
  identityEventNotes,
  identityEventToneDotClass,
  identitySlaBadgeClass,
  identityStatusBadgeClass,
  identityStatusLabel,
  identityTriggerLabel,
  mapIdentityEvent,
  riskScoreBadgeClass,
  sortIdentityEventsChronologically,
  type IdentityEventRow,
  type IdentityOpsPrefs,
  type IdentityQueueFilterId,
  IDENTITY_QUEUE_FILTERS,
} from "@/lib/driverIdentityDisplay";

import type { UserRole } from "@/lib/roles";

export type IdentityMetrics = {
  waiting: number;
  manual_review: number;
  high_risk: number;
  processed_today: number;
};

export type IdentityOpsStats = {
  avg_review_minutes: number;
  approval_rate: number;
  rejection_rate: number;
  expired_count: number;
  sla_compliance_rate: number;
  processed_today: number;
  dossiers_by_agent: Array<{ agent_user_id: string; count: number }>;
  sla_settings?: {
    sla_warning_minutes: number;
    sla_critical_minutes: number;
    lock_ttl_minutes: number;
  };
};

export type IdentityStaffOption = {
  id: string;
  role: UserRole;
  full_name: string | null;
  email: string | null;
};

export type IdentityDecisionView = {
  id: string;
  action: string;
  actor_name?: string | null;
  processing_duration_ms?: number | null;
  decision_change_index: number;
  created_at: string;
  notes?: string | null;
  previous_status?: string | null;
  new_status?: string;
};
export type IdentityCheckListItem = {
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
  selfie_thumb_signed_url?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  locked_by?: string | null;
  locked_by_name?: string | null;
  decision_change_count?: number;
  driver_profile?: {
    full_name: string | null;
    phone: string | null;
    city: string | null;
    status: string | null;
    is_online: boolean | null;
  } | null;
};

export type IdentityCheckDetail = Record<string, unknown> & {
  check?: Record<string, unknown> & {
    id?: string;
    status?: string;
    trigger_type?: string;
    reason?: string | null;
    city?: string | null;
    country?: string | null;
    risk_score?: number;
    confidence_score?: number | null;
    requires_manual_review?: boolean;
    provider?: string | null;
    created_at?: string;
    submitted_at?: string | null;
    verified_at?: string | null;
    expires_at?: string | null;
    device_id_hash?: string | null;
    ip_hash?: string | null;
    review_notes?: string | null;
    assigned_to?: string | null;
    assigned_to_name?: string | null;
    locked_by?: string | null;
    locked_by_name?: string | null;
    decision_change_count?: number;
    driver_profile?: {
      full_name?: string | null;
      phone?: string | null;
      city?: string | null;
      state?: string | null;
      status?: string | null;
      is_online?: boolean | null;
    } | null;
  };
  events?: IdentityEventRow[];
  decisions?: IdentityDecisionView[];
  selfie_signed_url?: string | null;
  profile_photo_signed_url?: string | null;
  sla_settings?: IdentityOpsStats["sla_settings"];
  lock_warning?: string | null;
};

type Props = {
  checks: IdentityCheckListItem[];
  loading: boolean;
  selectedId: string | null;
  selectedIndex: number;
  detail: IdentityCheckDetail | null;
  reviewNotes: string;
  busy: boolean;
  canManage: boolean;
  canAssign: boolean;
  userId: string | null;
  lockError: string | null;
  metrics: IdentityMetrics | null;
  stats: IdentityOpsStats | null;
  staffOptions: IdentityStaffOption[];
  opsPrefs: IdentityOpsPrefs;
  statusFilter: string;
  queueFilter: IdentityQueueFilterId;
  search: string;
  statuses: string[];
  onStatusFilterChange: (value: string) => void;
  onQueueFilterChange: (value: IdentityQueueFilterId) => void;
  onSearchChange: (value: string) => void;
  onFilter: () => void;
  onSelectCheck: (checkId: string) => void;
  onNavigateCheck: (direction: "prev" | "next") => void;
  onReviewNotesChange: (value: string) => void;
  onReview: (action: string) => void;
  onAssignCheck: (checkId: string, assigneeUserId: string) => void;
  onOpsPrefsChange: (patch: Partial<IdentityOpsPrefs>) => void;
};

function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${className}`}
    >
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-3 last:border-b-0 dark:border-slate-800 sm:grid-cols-[190px_minmax(0,1fr)]">
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="text-sm text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

function DetailCard({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="px-5 py-1">{children}</div>
    </section>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  tone: "approve" | "reject" | "photo" | "suspend" | "history";
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    approve:
      "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500/40 dark:bg-emerald-600 dark:hover:bg-emerald-500",
    reject:
      "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500/40 dark:bg-red-600 dark:hover:bg-red-500",
    photo:
      "bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500/40 dark:bg-amber-500 dark:hover:bg-amber-400",
    suspend:
      "bg-red-900 hover:bg-red-950 focus-visible:ring-red-900/40 dark:bg-red-900 dark:hover:bg-red-800",
    history:
      "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500/40 dark:bg-blue-600 dark:hover:bg-blue-500",
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-[44px] min-w-[140px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function IdentityPhotoComparePanel({
  selfieUrl,
  profilePhotoUrl,
}: {
  selfieUrl: string;
  profilePhotoUrl: string | null;
}) {
  const [zoom, setZoom] = useState(100);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const scale = zoom / 100;

  const renderPhoto = (
    url: string,
    label: string,
    alt: string,
  ) => (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 dark:border-slate-700">
        <div className="flex h-[280px] items-center justify-center overflow-auto md:h-[320px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            style={{ transform: `scale(${scale})` }}
            className="max-h-full max-w-full object-contain transition-transform duration-200"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setExpandedUrl(url)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Agrandir
        </button>
        <a
          href={url}
          download
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Télécharger
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Ouvrir
        </a>
      </div>
    </div>
  );

  return (
    <>
      <div className="py-3">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Zoom comparatif
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-3 sm:max-w-xs">
            <span className="text-xs text-slate-500">50%</span>
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full accent-blue-600"
              aria-label="Zoom comparatif"
            />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {zoom}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {profilePhotoUrl ? (
            renderPhoto(profilePhotoUrl, "Photo identité / KYC", "Photo identité chauffeur")
          ) : (
            <div className="flex min-h-[280px] flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
              Aucune photo identité / KYC disponible.
            </div>
          )}
          {renderPhoto(selfieUrl, "Selfie de vérification", "Selfie chauffeur")}
        </div>
      </div>

      {expandedUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setExpandedUrl(null)}
          role="presentation"
        >
          <div className="relative max-h-[92vh] max-w-5xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={expandedUrl}
              alt="Photo agrandie"
              className="max-h-[92vh] w-full rounded-2xl object-contain"
            />
            <button
              type="button"
              onClick={() => setExpandedUrl(null)}
              className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function EventTimeline({ events }: { events: IdentityEventRow[] }) {
  const sorted = useMemo(
    () => sortIdentityEventsChronologically(events),
    [events],
  );

  if (sorted.length === 0) {
    return (
      <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
        Aucun événement enregistré.
      </p>
    );
  }

  return (
    <div className="relative space-y-0 py-2">
      {sorted.map((event, index) => {
        const display = mapIdentityEvent(event);
        const notes = identityEventNotes(event);
        const isLast = index === sorted.length - 1;

        return (
          <div key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!isLast ? (
              <span className="absolute left-[15px] top-8 h-[calc(100%-12px)] w-px bg-slate-200 dark:bg-slate-700" />
            ) : null}
            <div
              className={`relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ring-4 ${identityEventToneDotClass(display.tone)} bg-white dark:bg-slate-900`}
            >
              <span aria-hidden>{display.icon}</span>
            </div>
            <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/80 p-4 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {display.label}
                </div>
                <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                  <div>{formatIdentityTime(event.created_at)}</div>
                  <div>{formatIdentityDate(event.created_at)}</div>
                </div>
              </div>
              {notes ? (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  {notes}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DriverIdentityControlCenter(props: Props) {
  const {
    checks,
    loading,
    selectedId,
    selectedIndex,
    detail,
    reviewNotes,
    busy,
    canManage,
    canAssign,
    userId,
    lockError,
    metrics,
    stats,
    staffOptions,
    opsPrefs,
    statusFilter,
    queueFilter,
    search,
    statuses,
    onStatusFilterChange,
    onQueueFilterChange,
    onSearchChange,
    onFilter,
    onSelectCheck,
    onNavigateCheck,
    onReviewNotesChange,
    onReview,
    onAssignCheck,
    onOpsPrefsChange,
  } = props;

  const check = detail?.check;
  const decisions = detail?.decisions ?? [];
  const slaSettings = detail?.sla_settings ?? stats?.sla_settings;
  const driverProfile = check?.driver_profile;
  const events = detail?.events ?? [];
  const selfieUrl =
    typeof detail?.selfie_signed_url === "string" ? detail.selfie_signed_url : null;
  const profilePhotoUrl =
    typeof detail?.profile_photo_signed_url === "string"
      ? detail.profile_photo_signed_url
      : null;

  const riskReasonBadges = useMemo(
    () =>
      check
        ? buildIdentityRiskReasonBadges({
            trigger_type: String(check.trigger_type ?? ""),
            reason: check.reason ?? null,
            device_id_hash: check.device_id_hash ?? null,
            ip_hash: check.ip_hash ?? null,
            requires_manual_review: Boolean(check.requires_manual_review),
            risk_score: Number(check.risk_score ?? 0),
          })
        : [],
    [check],
  );

  const waitSla = useMemo(
    () =>
      check
        ? evaluateIdentityWaitSla({
            status: String(check.status ?? ""),
            created_at: String(check.created_at ?? ""),
            submitted_at: check.submitted_at ?? null,
            sla_warning_minutes: slaSettings?.sla_warning_minutes,
            sla_critical_minutes: slaSettings?.sla_critical_minutes,
          })
        : null,
    [check, slaSettings?.sla_critical_minutes, slaSettings?.sla_warning_minutes],
  );

  const listSlaSettings = stats?.sla_settings ?? slaSettings;

  const scrollToHistory = useCallback(() => {
    document.getElementById("driver-identity-history")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleSuspend = useCallback(() => {
    const name = driverProfile?.full_name ?? "ce chauffeur";
    const confirmed = window.confirm(
      `Confirmer la suspension de ${name} ? Cette action bloque l'accès du chauffeur.`,
    );
    if (confirmed) onReview("suspend");
  }, [driverProfile?.full_name, onReview]);

  useEffect(() => {
    if (!canManage || !check || busy) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        onReview("approve");
      } else if (key === "r") {
        event.preventDefault();
        onReview("reject");
      } else if (key === "n") {
        event.preventDefault();
        onReview("request_new_photo");
      } else if (key === "s") {
        event.preventDefault();
        handleSuspend();
      } else if (key === "arrowleft" && event.altKey) {
        event.preventDefault();
        onNavigateCheck("prev");
      } else if (key === "arrowright" && event.altKey) {
        event.preventDefault();
        onNavigateCheck("next");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, canManage, check, handleSuspend, onNavigateCheck, onReview]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400">
              Control Center
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-3xl">
              Vérification identité chauffeur
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Revue manuelle, selfies, historique et audit — interface ops premium
              pour une décision rapide et traçable.
            </p>
          </div>
          <Link
            href="/admin/driver-identity/settings"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Paramètres moteur de risque
          </Link>
        </header>

        {metrics ? (
          <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "En attente", value: metrics.waiting, tone: "text-blue-700 dark:text-blue-300" },
              { label: "Revue manuelle", value: metrics.manual_review, tone: "text-amber-700 dark:text-amber-300" },
              { label: "Risque élevé", value: metrics.high_risk, tone: "text-red-700 dark:text-red-300" },
              { label: "Traités aujourd'hui", value: metrics.processed_today, tone: "text-emerald-700 dark:text-emerald-300" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {item.label}
                </div>
                <div className={`mt-1 text-2xl font-bold ${item.tone}`}>{item.value}</div>
              </div>
            ))}
          </section>
        ) : null}

        {stats ? (
          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Statistiques Ops (30 jours)
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Temps moyen", `${stats.avg_review_minutes} min`],
                ["Approbation", `${stats.approval_rate}%`],
                ["Refus", `${stats.rejection_rate}%`],
                ["Expirés", String(stats.expired_count)],
                ["SLA respecté", `${stats.sla_compliance_rate}%`],
                ["Agents actifs", String(stats.dossiers_by_agent.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={opsPrefs.autoAdvanceNext}
              onChange={(event) =>
                onOpsPrefsChange({ autoAdvanceNext: event.target.checked })
              }
            />
            Ouvrir le dossier suivant après décision
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={opsPrefs.fastProcessingMode}
              onChange={(event) =>
                onOpsPrefsChange({ fastProcessingMode: event.target.checked })
              }
            />
            Mode traitement rapide
          </label>
        </section>

        <section className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap gap-2">
            {IDENTITY_QUEUE_FILTERS.map((filter) => {
              const active = queueFilter === filter.id;
              return (
                <button
                  key={filter.id || "all"}
                  type="button"
                  onClick={() => onQueueFilterChange(filter.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            >
              {statuses.map((status) => (
                <option key={status || "all"} value={status}>
                  {status ? identityStatusLabel(status) : "Tous les statuts"}
                </option>
              ))}
            </select>
            <input
              placeholder="Rechercher chauffeur, ville, ID…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={onFilter}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              Filtrer
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                File d&apos;attente
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {loading ? "Chargement…" : `${checks.length} vérification(s)`}
              </p>
            </div>
            <div className="max-h-[72vh] space-y-2 overflow-y-auto p-3">
              {checks.length === 0 && !loading ? (
                <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">
                  Aucune vérification trouvée.
                </p>
              ) : null}
              {checks.map((item) => {
                const selected = selectedId === item.id;
                const itemSla = evaluateIdentityWaitSla({
                  status: item.status,
                  created_at: item.created_at,
                  submitted_at: item.submitted_at,
                  sla_warning_minutes: listSlaSettings?.sla_warning_minutes,
                  sla_critical_minutes: listSlaSettings?.sla_critical_minutes,
                });
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectCheck(item.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition-all duration-200 ${
                      selected
                        ? "border-blue-500 bg-blue-50/70 shadow-md ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/30"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/80"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
                        {item.selfie_thumb_signed_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.selfie_thumb_signed_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-lg text-slate-400">
                            🪪
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                              {item.driver_profile?.full_name ?? item.driver_id}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {identityTriggerLabel(item.trigger_type)}
                            </div>
                          </div>
                          <Badge className={identityStatusBadgeClass(item.status)}>
                            {identityStatusLabel(item.status)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge className={riskScoreBadgeClass(item.risk_score)}>
                            Risque {item.risk_score}
                          </Badge>
                        {item.requires_manual_review ? (
                          <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                            Revue manuelle
                          </Badge>
                        ) : null}
                        {item.assigned_to_name ? (
                          <Badge className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200">
                            {item.assigned_to === userId ? "Attribué à moi" : item.assigned_to_name}
                          </Badge>
                        ) : null}
                      </div>
                      {itemSla ? (
                        <div className="mt-2">
                          <Badge className={identitySlaBadgeClass(itemSla.tone)}>
                            {itemSla.label}
                          </Badge>
                        </div>
                      ) : null}
                      {item.locked_by_name && item.locked_by !== userId ? (
                        <div className="mt-2 text-xs text-red-600 dark:text-red-300">
                          Verrouillé par {item.locked_by_name}
                        </div>
                      ) : null}
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatIdentityDateTime(item.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-5">
            {!check ? (
              <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
                <div>
                  <div className="text-4xl">🪪</div>
                  <p className="mt-3 text-base font-medium text-slate-900 dark:text-slate-100">
                    Sélectionnez une vérification
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Les détails, le selfie et l&apos;historique s&apos;afficheront ici.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {driverProfile?.full_name ?? check.id}
                    </div>
                    {waitSla ? (
                      <div className="mt-1">
                        <Badge className={identitySlaBadgeClass(waitSla.tone)}>
                          {waitSla.label}
                        </Badge>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={selectedIndex <= 0}
                      onClick={() => onNavigateCheck("prev")}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      ← Dossier précédent
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedIndex + 1} / {checks.length}
                    </span>
                    <button
                      type="button"
                      disabled={selectedIndex < 0 || selectedIndex >= checks.length - 1}
                      onClick={() => onNavigateCheck("next")}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      Dossier suivant →
                    </button>
                  </div>
                </div>

                {lockError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                    {lockError}
                  </div>
                ) : null}

                {canAssign && check.id ? (
                  <DetailCard title="Attribution" subtitle="Super Admin — assigner à un agent Ops">
                    <div className="flex flex-wrap items-center gap-3 py-3">
                      <select
                        defaultValue={String(check.assigned_to ?? "")}
                        onChange={(event) => {
                          const assignee = event.target.value;
                          if (assignee) onAssignCheck(String(check.id), assignee);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Non assigné</option>
                        {staffOptions.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.full_name ?? staff.email ?? staff.id} ({staff.role})
                          </option>
                        ))}
                      </select>
                      {check.assigned_to_name ? (
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                          Actuellement : {check.assigned_to_name}
                        </span>
                      ) : null}
                    </div>
                  </DetailCard>
                ) : null}

                <DetailCard title="Informations du chauffeur">
                  <InfoRow label="Nom" value={driverProfile?.full_name ?? "—"} />
                  <InfoRow label="Téléphone" value={driverProfile?.phone ?? "—"} />
                  <InfoRow
                    label="Ville"
                    value={driverProfile?.city ?? check.city ?? "—"}
                  />
                  <InfoRow label="État" value={driverProfile?.state ?? "—"} />
                  <InfoRow
                    label="Statut"
                    value={
                      <Badge
                        className={driverProfileStatusBadgeClass(
                          driverProfile?.status ?? null,
                        )}
                      >
                        {driverProfileStatusLabel(driverProfile?.status ?? null)}
                      </Badge>
                    }
                  />
                  <InfoRow
                    label="En ligne"
                    value={
                      driverProfile?.is_online ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          Oui
                        </span>
                      ) : (
                        <span className="text-slate-600 dark:text-slate-400">Non</span>
                      )
                    }
                  />
                </DetailCard>

                <DetailCard
                  title="Vérification"
                  subtitle="Synthèse de la demande et des scores"
                >
                  <InfoRow
                    label="Statut"
                    value={
                      <Badge className={identityStatusBadgeClass(String(check.status ?? ""))}>
                        {identityStatusLabel(String(check.status ?? ""))}
                      </Badge>
                    }
                  />
                  <InfoRow
                    label="Déclencheur"
                    value={identityTriggerLabel(String(check.trigger_type ?? ""))}
                  />
                  <InfoRow
                    label="Niveau de risque"
                    value={
                      <Badge className={riskScoreBadgeClass(Number(check.risk_score ?? 0))}>
                        {check.risk_score ?? 0} / 100
                      </Badge>
                    }
                  />
                  <InfoRow
                    label="Raisons du risque"
                    value={
                      riskReasonBadges.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {riskReasonBadges.map((badge) => (
                            <Badge key={badge.key} className={badge.className}>
                              {badge.label}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <InfoRow
                    label="Score de confiance"
                    value={
                      <Badge
                        className={confidenceScoreBadgeClass(
                          check.confidence_score == null
                            ? null
                            : Number(check.confidence_score),
                        )}
                      >
                        {check.confidence_score == null
                          ? "Non calculé"
                          : `${check.confidence_score} / 100`}
                      </Badge>
                    }
                  />
                  <InfoRow label="Fournisseur" value={check.provider ?? "—"} />
                  <InfoRow
                    label="Date de création"
                    value={formatIdentityDateTime(String(check.created_at ?? ""))}
                  />
                  <InfoRow
                    label="Date d'envoi"
                    value={formatIdentityDateTime(check.submitted_at ?? null)}
                  />
                  <InfoRow
                    label="Date de validation"
                    value={formatIdentityDateTime(check.verified_at ?? null)}
                  />
                  <InfoRow
                    label="Expiration"
                    value={formatIdentityDateTime(check.expires_at ?? null)}
                  />
                  {check.reason ? (
                    <InfoRow label="Motif" value={check.reason} />
                  ) : null}
                </DetailCard>

                <DetailCard
                  title="Comparaison identité"
                  subtitle="Selfie de vérification vs photo identité / KYC"
                >
                  {selfieUrl ? (
                    <IdentityPhotoComparePanel
                      selfieUrl={selfieUrl}
                      profilePhotoUrl={profilePhotoUrl}
                    />
                  ) : (
                    <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
                      Aucun selfie disponible pour cette vérification.
                    </p>
                  )}
                </DetailCard>

                <DetailCard
                  title="Informations techniques"
                  subtitle="Contexte appareil et réseau"
                >
                  <InfoRow
                    label="Device ID"
                    value={
                      <span className="font-mono text-xs break-all">
                        {check.device_id_hash ?? "—"}
                      </span>
                    }
                  />
                  <InfoRow
                    label="IP Hash"
                    value={
                      <span className="font-mono text-xs break-all">
                        {check.ip_hash ?? "—"}
                      </span>
                    }
                  />
                  <InfoRow label="Pays" value={check.country ?? "—"} />
                  <InfoRow label="Ville" value={check.city ?? "—"} />
                </DetailCard>

                {canManage ? (
                  <DetailCard
                    title="Actions de revue"
                    subtitle="Décision ops avec note interne optionnelle"
                  >
                    <textarea
                      placeholder="Note interne (visible dans l'historique)"
                      value={reviewNotes}
                      onChange={(event) => onReviewNotesChange(event.target.value)}
                      rows={3}
                      disabled={busy || Boolean(lockError)}
                      className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <ActionButton
                        label="Approuver"
                        tone="approve"
                        disabled={busy || Boolean(lockError)}
                        onClick={() => onReview("approve")}
                        icon={
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.25a1 1 0 0 1-1.414 0l-3.25-3.25a1 1 0 1 1 1.414-1.414l2.543 2.543 6.543-6.543a1 1 0 0 1 1.412 0Z" clipRule="evenodd" />
                          </svg>
                        }
                      />
                      <ActionButton
                        label="Refuser"
                        tone="reject"
                        disabled={busy || Boolean(lockError)}
                        onClick={() => onReview("reject")}
                        icon={
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z" clipRule="evenodd" />
                          </svg>
                        }
                      />
                      <ActionButton
                        label="Nouvelle photo"
                        tone="photo"
                        disabled={busy || Boolean(lockError)}
                        onClick={() => onReview("request_new_photo")}
                        icon={
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path d="M4 5a2 2 0 0 1 2-2h1.172a2 2 0 0 0 1.414-.586l.828-.828A2 2 0 0 1 11.172 1H12a2 2 0 0 1 2 2v1h1a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h1V5Z" />
                            <path d="M10 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
                          </svg>
                        }
                      />
                      <ActionButton
                        label="Suspendre"
                        tone="suspend"
                        disabled={busy || Boolean(lockError)}
                        onClick={handleSuspend}
                        icon={
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h9.5A2.25 2.25 0 0 1 17 4.25v11.5A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75V4.25ZM8 7a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm5-1a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Z" clipRule="evenodd" />
                          </svg>
                        }
                      />
                      <ActionButton
                        label="Historique"
                        tone="history"
                        disabled={busy || Boolean(lockError)}
                        onClick={scrollToHistory}
                        icon={
                          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                            <path fillRule="evenodd" d="M10 18a8 8 0 1 0-8-8h1.25a.75.75 0 0 1 .53 1.28l-2.5 2.5a.75.75 0 0 1-1.06-1.06l.845-.845A6.5 6.5 0 1 1 10 16.5V14a.75.75 0 0 1 1.5 0v4.25A.75.75 0 0 1 10.75 19H6.5a.75.75 0 0 1 0-1.5H10Z" clipRule="evenodd" />
                          </svg>
                        }
                      />
                    </div>
                    {busy ? (
                      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                        Traitement en cours…
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Raccourcis : A Approuver · R Refuser · N Nouvelle photo · S Suspendre · Alt+←/→
                      dossier précédent/suivant
                    </p>
                  </DetailCard>
                ) : null}

                <DetailCard
                  title="Historique des décisions"
                  subtitle="Qui a décidé, combien de temps, changements de décision"
                >
                  {decisions.length === 0 ? (
                    <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
                      Aucune décision enregistrée.
                    </p>
                  ) : (
                    <div className="space-y-3 py-2">
                      <InfoRow
                        label="Changements de décision"
                        value={String(check.decision_change_count ?? decisions[0]?.decision_change_index ?? 0)}
                      />
                      {decisions.map((decision) => (
                        <div
                          key={decision.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {identityDecisionActionLabel(decision.action)} ·{" "}
                              {decision.actor_name ?? "Système"}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {formatIdentityDateTime(decision.created_at)}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                            Durée de traitement :{" "}
                            {formatProcessingDuration(decision.processing_duration_ms)}
                          </div>
                          {decision.notes ? (
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                              {decision.notes}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </DetailCard>

                <DetailCard
                  id="driver-identity-history"
                  title="Historique"
                  subtitle="Chronologie des événements de vérification"
                >
                  <EventTimeline events={events} />
                </DetailCard>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
