import type { DriverIdentityCheckStatus, DriverIdentityTriggerType } from "./driverIdentityTypes";

export type IdentityEventRow = {
  id: string;
  event_type: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type IdentityEventTone = "neutral" | "info" | "success" | "warning" | "danger";

export type IdentityEventDisplay = {
  icon: string;
  label: string;
  tone: IdentityEventTone;
};

const STATUS_LABELS: Record<string, string> = {
  required: "Requis",
  pending: "En attente",
  submitted: "Soumis",
  manual_review: "Revue manuelle",
  verified: "Vérifié",
  rejected: "Refusé",
  expired: "Expiré",
  canceled: "Annulé",
};

const TRIGGER_LABELS: Record<string, string> = {
  first_online: "Première mise en ligne",
  new_device: "Nouvel appareil",
  city_change: "Changement de ville",
  country_change: "Changement de pays",
  inactivity: "Inactivité",
  random: "Contrôle aléatoire",
  client_report: "Signalement client",
  suspicious_behavior: "Comportement suspect",
  phone_change: "Changement de téléphone",
  profile_photo_change: "Changement de photo",
  post_suspension: "Après suspension",
  periodic: "Contrôle périodique",
  admin_manual: "Demande admin",
};

const EVENT_DISPLAY: Record<string, IdentityEventDisplay> = {
  check_created: { icon: "✓", label: "Vérification créée", tone: "info" },
  check_expired: { icon: "⏱", label: "Vérification expirée", tone: "warning" },
  selfie_uploaded: { icon: "📷", label: "Selfie envoyé", tone: "info" },
  check_submitted: { icon: "📤", label: "Demande soumise", tone: "info" },
  check_approved: { icon: "✅", label: "Vérification approuvée", tone: "success" },
  check_rejected: { icon: "✕", label: "Vérification refusée", tone: "danger" },
  new_photo_requested: { icon: "📷", label: "Nouvelle photo demandée", tone: "warning" },
  driver_suspended: { icon: "🛡", label: "Chauffeur suspendu", tone: "danger" },
};

export function identityStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

export function identityTriggerLabel(
  trigger: DriverIdentityTriggerType | string | null | undefined,
): string {
  if (!trigger) return "—";
  return TRIGGER_LABELS[trigger] ?? trigger;
}

export function identityStatusBadgeClass(
  status: DriverIdentityCheckStatus | string | null | undefined,
): string {
  switch (status) {
    case "verified":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "required":
    case "manual_review":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200";
    case "rejected":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200";
    case "pending":
    case "submitted":
      return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200";
    case "expired":
    case "canceled":
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
}

export function driverProfileStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "suspended":
      return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300";
    case "rejected":
      return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200";
    case "pending":
    default:
      return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200";
  }
}

export function driverProfileStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "approved":
      return "Approuvé";
    case "suspended":
      return "Suspendu";
    case "rejected":
      return "Refusé";
    case "pending":
      return "En attente";
    default:
      return status ?? "—";
  }
}

export function riskScoreBadgeClass(score: number | null | undefined): string {
  const value = Number(score ?? 0);
  if (value <= 30) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
  }
  if (value <= 60) {
    return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200";
  }
  return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200";
}

export function confidenceScoreBadgeClass(score: number | null | undefined): string {
  if (score == null || Number.isNaN(Number(score))) {
    return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
  const value = Number(score);
  if (value <= 50) {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200";
  }
  if (value <= 75) {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200";
}

export function formatIdentityDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatIdentityDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatIdentityTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mapIdentityEvent(event: IdentityEventRow): IdentityEventDisplay {
  return (
    EVENT_DISPLAY[event.event_type] ?? {
      icon: "•",
      label: event.event_type.replaceAll("_", " "),
      tone: "neutral",
    }
  );
}

export function identityEventNotes(event: IdentityEventRow): string | null {
  const notes = event.metadata?.notes;
  if (typeof notes === "string" && notes.trim()) return notes.trim();
  return null;
}

export function identityEventToneDotClass(tone: IdentityEventTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500 ring-emerald-500/30";
    case "danger":
      return "bg-red-500 ring-red-500/30";
    case "warning":
      return "bg-amber-500 ring-amber-500/30";
    case "info":
      return "bg-blue-500 ring-blue-500/30";
    default:
      return "bg-slate-400 ring-slate-400/30";
  }
}

export function sortIdentityEventsChronologically(events: IdentityEventRow[]): IdentityEventRow[] {
  return [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export const IDENTITY_QUEUE_FILTERS = [
  { id: "", label: "Tous" },
  { id: "waiting", label: "En attente" },
  { id: "manual_review", label: "Revue manuelle" },
  { id: "high_risk", label: "Risque élevé" },
  { id: "expired", label: "Expiré" },
] as const;

export type IdentityQueueFilterId = (typeof IDENTITY_QUEUE_FILTERS)[number]["id"];

export type IdentityRiskReasonBadge = {
  key: string;
  label: string;
  className: string;
};

const RISK_REASON_BADGE_CLASS = {
  info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  danger:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200",
} as const;

const TRIGGER_RISK_BADGES: Record<
  string,
  { label: string; tone: keyof typeof RISK_REASON_BADGE_CLASS }
> = {
  phone_change: { label: "Changement téléphone", tone: "warning" },
  new_device: { label: "Nouvel appareil", tone: "warning" },
  profile_photo_change: { label: "Changement photo profil", tone: "warning" },
  city_change: { label: "Changement de ville", tone: "info" },
  country_change: { label: "Changement de pays", tone: "warning" },
  client_report: { label: "Signalement client", tone: "danger" },
  suspicious_behavior: { label: "Comportement suspect", tone: "danger" },
  post_suspension: { label: "Après suspension", tone: "danger" },
  admin_manual: { label: "Demande administrative", tone: "danger" },
  inactivity: { label: "Inactivité prolongée", tone: "info" },
  first_online: { label: "Première mise en ligne", tone: "info" },
  random: { label: "Contrôle aléatoire", tone: "info" },
  periodic: { label: "Contrôle périodique", tone: "info" },
};

const WAITING_STATUSES = new Set([
  "required",
  "pending",
  "submitted",
  "manual_review",
]);

export function formatIdentityWaitSla(input: {
  status: string | null | undefined;
  created_at: string | null | undefined;
  submitted_at?: string | null;
}): string | null {
  const status = String(input.status ?? "");
  if (!WAITING_STATUSES.has(status)) return null;

  const sinceIso = input.submitted_at ?? input.created_at;
  if (!sinceIso) return null;

  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return null;

  const elapsedMs = Date.now() - since.getTime();
  if (elapsedMs < 0) return null;

  const totalMinutes = Math.floor(elapsedMs / 60000);
  if (totalMinutes < 60) {
    return `En attente depuis ${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `En attente depuis ${hours} h`;
  }
  return `En attente depuis ${hours} h ${minutes}`;
}

export function buildIdentityRiskReasonBadges(check: {
  trigger_type?: string | null;
  reason?: string | null;
  device_id_hash?: string | null;
  ip_hash?: string | null;
  requires_manual_review?: boolean;
  risk_score?: number | null;
}): IdentityRiskReasonBadge[] {
  const badges: IdentityRiskReasonBadge[] = [];
  const seen = new Set<string>();

  const push = (
    key: string,
    label: string,
    tone: keyof typeof RISK_REASON_BADGE_CLASS,
  ) => {
    if (seen.has(key)) return;
    seen.add(key);
    badges.push({
      key,
      label,
      className: RISK_REASON_BADGE_CLASS[tone],
    });
  };

  const trigger = String(check.trigger_type ?? "").trim();
  if (trigger) {
    const mapped = TRIGGER_RISK_BADGES[trigger];
    push(
      `trigger:${trigger}`,
      mapped?.label ?? identityTriggerLabel(trigger),
      mapped?.tone ?? "info",
    );
  }

  if (check.ip_hash && ["new_device", "suspicious_behavior", "admin_manual"].includes(trigger)) {
    push("ip_hash", "Nouvelle IP", "warning");
  }

  if (check.device_id_hash && trigger === "new_device") {
    push("device_hash", "Empreinte appareil inconnue", "warning");
  }

  if (check.requires_manual_review) {
    push("manual_review", "Revue manuelle requise", "danger");
  }

  if (Number(check.risk_score ?? 0) >= 61) {
    push("high_risk_score", "Score de risque élevé", "danger");
  }

  const reason = String(check.reason ?? "").trim();
  if (reason) {
    const triggerLabel = trigger ? identityTriggerLabel(trigger) : "";
    if (reason !== triggerLabel && reason.length <= 96) {
      push(`reason:${reason}`, reason, "info");
    }
  }

  return badges;
}

export function matchesIdentityQueueFilter(
  check: {
    status: string;
    risk_score: number;
    requires_manual_review: boolean;
  },
  filter: IdentityQueueFilterId,
): boolean {
  if (!filter) return true;

  switch (filter) {
    case "high_risk":
      return Number(check.risk_score) >= 61;
    case "waiting":
      return WAITING_STATUSES.has(check.status);
    case "expired":
      return check.status === "expired";
    case "manual_review":
      return check.requires_manual_review || check.status === "manual_review";
    default:
      return true;
  }
}
