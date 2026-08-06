/**
 * Display helpers for Admin Drivers Ops Center (UI-only).
 * Completeness rules mirror apps/web/app/admin/drivers/page.tsx — do not change approve server logic.
 */

export type VehicleType = "bike" | "moto" | "car" | "other";

export type DriverDocType =
  | "profile_photo"
  | "id_card_front"
  | "id_card_back"
  | "license_front"
  | "license_back"
  | "insurance"
  | "registration"
  | "driver_license"
  | "id_card"
  | "passport"
  | "other";

export type DriverReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | "disabled";

export type DriverActionStatus = "approved" | "rejected" | "suspended" | "disabled";

export type DocBadgeTone = "green" | "yellow" | "orange" | "red" | "slate";

export type AdminDriverDocument = {
  id: string;
  user_id: string;
  doc_type: DriverDocType | string;
  status: DriverReviewStatus | string;
  file_path: string;
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  signed_url?: string | null;
  is_image?: boolean;
};

export type AdminDriverVehicle = {
  id: string | null;
  photo_url: string | null;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  plate: string | null;
};

export type AdminDriverListItem = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  emergency_phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  transport_mode: VehicleType;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  status: DriverReviewStatus;
  documents_required: boolean;
  missing_requirements: string | null;
  computed_missing_requirements: string[];
  completeness_percent: number;
  is_online: boolean;
  photo_url: string | null;
  created_at: string | null;
  /** Persisted activity signal only (profiles.last_seen_at or driver_profiles.updated_at). */
  last_activity_at: string | null;
  rating: number | null;
  rating_count: number | null;
  total_deliveries: number | null;
  taxi_completed_rides: number | null;
  acceptance_rate: number | null;
  cancellation_rate: number | null;
  stripe_identity_status: string | null;
  documents: AdminDriverDocument[];
  vehicle: AdminDriverVehicle | null;
};

export type DriverSortFilters = {
  q: string;
  status: string;
  mode: string;
  city: string;
  state: string;
  docsIncomplete: boolean;
  identity: string;
  online: string;
  dateFrom: string;
  minCompleteness: string;
};

export const DEFAULT_DRIVER_FILTERS: DriverSortFilters = {
  q: "",
  status: "",
  mode: "",
  city: "",
  state: "",
  docsIncomplete: false,
  identity: "",
  online: "",
  dateFrom: "",
  minCompleteness: "",
};

export type DriverActionKey =
  | "approve"
  | "reject"
  | "suspend"
  | "disable"
  | "reactivate"
  | "enable"
  | "view"
  | "history"
  | "identity";

export type DriverUiAction = {
  key: DriverActionKey;
  label: string;
  status?: DriverActionStatus;
  disabled?: boolean;
  title?: string;
  href?: string;
};

const REQUIRED_BASE_CHECKS = 11; // name..dob + photo + id front/back (motor adds more)

export function normalizeSearchText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeVehicleType(value: string | null | undefined): VehicleType {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "bike" || v === "bicycle") return "bike";
  if (v === "moto" || v === "motorcycle" || v === "scooter") return "moto";
  if (v === "car" || v === "auto") return "car";
  if (v === "other") return "other";
  return "car";
}

export function normalizeDriverStatus(value: string | null | undefined): DriverReviewStatus {
  const s = String(value ?? "").trim().toLowerCase();
  if (
    s === "approved" ||
    s === "rejected" ||
    s === "incomplete" ||
    s === "suspended" ||
    s === "disabled" ||
    s === "pending"
  ) {
    return s;
  }
  return "pending";
}

export function computeMissingRequirementsForRow(input: {
  transport_mode: VehicleType;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  documents: Array<{ doc_type: string }>;
}): string[] {
  const missing: string[] = [];
  const docTypes = new Set(input.documents.map((doc) => doc.doc_type));

  if (!input.full_name) missing.push("full name");
  if (!input.phone) missing.push("phone number");
  if (!input.emergency_phone) missing.push("emergency phone number");
  if (!input.address) missing.push("address");
  if (!input.city) missing.push("city");
  if (!input.state) missing.push("state");
  if (!input.zip_code) missing.push("zip code");
  if (!input.date_of_birth) missing.push("date of birth");

  if (!docTypes.has("profile_photo")) missing.push("profile photo");
  if (!docTypes.has("id_card_front")) missing.push("ID card front");
  if (!docTypes.has("id_card_back")) missing.push("ID card back");

  const requiresMotorDocs =
    input.transport_mode === "moto" || input.transport_mode === "car";

  if (requiresMotorDocs) {
    if (!input.vehicle_brand) missing.push("vehicle brand");
    if (!input.vehicle_model) missing.push("vehicle model");
    if (!input.vehicle_year) missing.push("vehicle year");
    if (!input.vehicle_color) missing.push("vehicle color");
    if (!input.plate_number) missing.push("plate number");
    if (!input.license_number) missing.push("license number");
    if (!input.license_expiry) missing.push("license expiry");
    if (!docTypes.has("license_front")) missing.push("license front");
    if (!docTypes.has("license_back")) missing.push("license back");
    if (!docTypes.has("insurance")) missing.push("insurance");
    if (!docTypes.has("registration")) missing.push("registration");
  }

  return missing;
}

export function completenessPercent(missingCount: number, transportMode: VehicleType): number {
  const total =
    REQUIRED_BASE_CHECKS +
    (transportMode === "moto" || transportMode === "car" ? 11 : 0);
  const filled = Math.max(0, total - missingCount);
  return Math.round((filled / total) * 100);
}

/**
 * Ops Center priority: lower = more urgent.
 * 0 pending review → 1 missing docs → 2 admin action (rejected)
 * → 3 suspended → 4 disabled → 5 approved online → 6 approved offline
 */
export function getOpsPriorityScore(row: Pick<
  AdminDriverListItem,
  "status" | "computed_missing_requirements" | "is_online"
>): number {
  const missing = row.computed_missing_requirements.length > 0;
  // Terminal / admin statuses keep their bucket even when docs are incomplete.
  if (row.status === "pending") return 0;
  if (row.status === "rejected") return 2;
  if (row.status === "suspended") return 3;
  if (row.status === "disabled") return 4;
  if (row.status === "incomplete" || missing) return 1;
  if (row.status === "approved") return row.is_online ? 5 : 6;
  return 7;
}

function activityMs(row: Pick<AdminDriverListItem, "last_activity_at" | "created_at">): number {
  const raw = row.last_activity_at || row.created_at;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function sortDriversOps(items: AdminDriverListItem[]): AdminDriverListItem[] {
  return [...items].sort((a, b) => {
    const pa = getOpsPriorityScore(a);
    const pb = getOpsPriorityScore(b);
    if (pa !== pb) return pa - pb;

    // Within approved (and same online bucket): recent activity, then signup date.
    if (a.status === "approved" && b.status === "approved") {
      const act = activityMs(b) - activityMs(a);
      if (act !== 0) return act;
      const createdA = a.created_at ? Date.parse(a.created_at) : 0;
      const createdB = b.created_at ? Date.parse(b.created_at) : 0;
      if (createdA !== createdB) return createdB - createdA;
    }

    return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""));
  });
}

export function driverStatusBadge(status: DriverReviewStatus): {
  label: string;
  tone: DocBadgeTone;
} {
  switch (status) {
    case "approved":
      return { label: "Approved", tone: "green" };
    case "pending":
      return { label: "Pending", tone: "yellow" };
    case "incomplete":
      return { label: "Incomplete", tone: "orange" };
    case "rejected":
      return { label: "Rejected", tone: "red" };
    case "suspended":
      return { label: "Suspended", tone: "slate" };
    case "disabled":
      return { label: "Disabled", tone: "slate" };
    default:
      return { label: status, tone: "slate" };
  }
}

export function onlineBadge(isOnline: boolean): { label: string; tone: DocBadgeTone } {
  return isOnline
    ? { label: "Online", tone: "green" }
    : { label: "Offline", tone: "slate" };
}

function worstDocTone(statuses: string[]): DocBadgeTone {
  const set = new Set(statuses.map((s) => String(s).toLowerCase()));
  if (set.has("rejected")) return "red";
  if (set.has("incomplete")) return "orange";
  if (set.has("pending")) return "yellow";
  if (set.has("approved")) return "green";
  return "slate";
}

export function aggregateDocGroupBadge(
  documents: AdminDriverDocument[],
  docTypes: string[],
  opts?: { licenseExpiry?: string | null }
): { label: string; tone: DocBadgeTone; detail: string } {
  const matched = documents.filter((d) => docTypes.includes(String(d.doc_type)));
  if (matched.length === 0) {
    return { label: "Missing", tone: "slate", detail: "missing" };
  }

  if (opts?.licenseExpiry) {
    const exp = Date.parse(opts.licenseExpiry);
    if (Number.isFinite(exp)) {
      const days = (exp - Date.now()) / (1000 * 60 * 60 * 24);
      if (days < 0) return { label: "Expired", tone: "red", detail: "expired" };
      if (days <= 30) return { label: "Expiring Soon", tone: "orange", detail: "expiring" };
    }
  }

  const tone = worstDocTone(matched.map((d) => String(d.status)));
  if (tone === "green") return { label: "Valid", tone, detail: "approved" };
  if (tone === "yellow") return { label: "Pending", tone, detail: "pending" };
  if (tone === "orange") return { label: "Pending", tone, detail: "incomplete" };
  if (tone === "red") return { label: "Rejected", tone, detail: "rejected" };
  return { label: "Missing", tone: "slate", detail: "unknown" };
}

export function stripeIdentityBadge(status: string | null | undefined): {
  label: string;
  tone: DocBadgeTone;
} {
  const s = String(status ?? "").toLowerCase();
  if (!s || s === "not_started") return { label: "Not started", tone: "slate" };
  if (s === "verified") return { label: "Verified", tone: "green" };
  if (s === "pending" || s === "processing" || s === "requires_input") {
    return { label: "Pending", tone: "yellow" };
  }
  if (s === "failed" || s === "canceled" || s === "cancelled" || s === "rejected") {
    return { label: "Rejected", tone: "red" };
  }
  return { label: s, tone: "slate" };
}

export function driverStatusActions(
  status: DriverReviewStatus,
  opts: { canManage: boolean; missingCount: number; userId: string }
): DriverUiAction[] {
  if (!opts.canManage) {
    return [
      { key: "view", label: "View Details" },
      {
        key: "history",
        label: "History",
        href: `/admin/driver-identity?q=${encodeURIComponent(opts.userId)}`,
      },
    ];
  }

  const missing = opts.missingCount > 0;
  const approveDisabled = missing;
  const approveTitle = missing
    ? "Cannot approve: missing required information or documents"
    : undefined;

  switch (status) {
    case "pending":
    case "incomplete":
      return [
        {
          key: "approve",
          label: "Approve",
          status: "approved",
          disabled: approveDisabled,
          title: approveTitle,
        },
        { key: "reject", label: "Reject", status: "rejected" },
        { key: "view", label: "View Details" },
      ];
    case "approved":
      return [
        { key: "view", label: "View Profile" },
        { key: "suspend", label: "Suspend", status: "suspended" },
        { key: "disable", label: "Disable", status: "disabled" },
        {
          key: "history",
          label: "History",
          href: `/admin/driver-identity?q=${encodeURIComponent(opts.userId)}`,
        },
        {
          key: "identity",
          label: "Audit",
          href: `/admin/identity?q=${encodeURIComponent(opts.userId)}`,
        },
      ];
    case "suspended":
      return [
        {
          key: "reactivate",
          label: "Reactivate",
          status: "approved",
          disabled: approveDisabled,
          title: approveTitle,
        },
        { key: "view", label: "View Details" },
        {
          key: "history",
          label: "History",
          href: `/admin/driver-identity?q=${encodeURIComponent(opts.userId)}`,
        },
      ];
    case "disabled":
      return [
        {
          key: "enable",
          label: "Enable",
          status: "approved",
          disabled: approveDisabled,
          title: approveTitle,
        },
        { key: "view", label: "View Details" },
        {
          key: "history",
          label: "History",
          href: `/admin/driver-identity?q=${encodeURIComponent(opts.userId)}`,
        },
      ];
    case "rejected":
      // No Approve — rejected drivers stay review-only until ops reopen via dossier.
      return [
        { key: "view", label: "View Details" },
        {
          key: "history",
          label: "History",
          href: `/admin/driver-identity?q=${encodeURIComponent(opts.userId)}`,
        },
      ];
    default:
      return [{ key: "view", label: "View Details" }];
  }
}

export function statusStepperIndex(row: AdminDriverListItem): number {
  // Created → Docs → Verification → Approved → Active → Online
  if (row.is_online && row.status === "approved") return 5;
  if (row.status === "approved") return 4;
  if (row.status === "pending" && row.computed_missing_requirements.length === 0) {
    return 2;
  }
  if (row.documents.length > 0) return 1;
  if (row.status === "rejected" || row.status === "suspended" || row.status === "disabled") {
    return row.documents.length > 0 ? 2 : 0;
  }
  return 0;
}

export function filterDrivers(
  items: AdminDriverListItem[],
  filters: DriverSortFilters
): AdminDriverListItem[] {
  const q = normalizeSearchText(filters.q);
  const fromMs = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : NaN;
  const minComp =
    filters.minCompleteness.trim() === "" ? null : Number(filters.minCompleteness);

  return items.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.mode && row.transport_mode !== filters.mode) return false;
    if (filters.city && normalizeSearchText(row.city ?? "") !== normalizeSearchText(filters.city)) {
      return false;
    }
    if (
      filters.state &&
      normalizeSearchText(row.state ?? "") !== normalizeSearchText(filters.state)
    ) {
      return false;
    }
    if (filters.docsIncomplete && row.computed_missing_requirements.length === 0) {
      return false;
    }
    if (filters.identity) {
      const idStatus = String(row.stripe_identity_status ?? "not_started").toLowerCase();
      if (idStatus !== filters.identity.toLowerCase()) return false;
    }
    if (filters.online === "online" && !row.is_online) return false;
    if (filters.online === "offline" && row.is_online) return false;
    if (Number.isFinite(fromMs) && row.created_at) {
      const created = Date.parse(row.created_at);
      if (Number.isFinite(created) && created < fromMs) return false;
    }
    if (minComp != null && Number.isFinite(minComp) && row.completeness_percent < minComp) {
      return false;
    }
    if (!q) return true;
    const hay = [
      row.user_id,
      row.full_name,
      row.email,
      row.phone,
      row.plate_number,
      row.city,
      row.state,
      row.license_number,
      row.transport_mode,
      row.stripe_identity_status,
      row.vehicle?.plate,
      row.vehicle?.make,
      row.vehicle?.model,
    ]
      .map((v) => normalizeSearchText(String(v ?? "")))
      .join(" ");
    return hay.includes(q);
  });
}

export function parseDriverFiltersFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null }
): DriverSortFilters {
  return {
    q: String(params.get("q") ?? ""),
    status: String(params.get("status") ?? ""),
    mode: String(params.get("mode") ?? ""),
    city: String(params.get("city") ?? ""),
    state: String(params.get("state") ?? ""),
    docsIncomplete: params.get("docs") === "incomplete",
    identity: String(params.get("identity") ?? ""),
    online: String(params.get("online") ?? ""),
    dateFrom: String(params.get("from") ?? ""),
    minCompleteness: String(params.get("minComp") ?? ""),
  };
}

export function driverFiltersToSearchParams(filters: DriverSortFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (k: string, v: string) => {
    const t = v.trim();
    if (t) params.set(k, t);
  };
  set("q", filters.q);
  set("status", filters.status);
  set("mode", filters.mode);
  set("city", filters.city);
  set("state", filters.state);
  if (filters.docsIncomplete) params.set("docs", "incomplete");
  set("identity", filters.identity);
  set("online", filters.online);
  set("from", filters.dateFrom);
  set("minComp", filters.minCompleteness);
  return params;
}

export function initialsFromName(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function partyDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  fallback = "Unknown driver"
): string {
  const n = String(name ?? "").trim();
  if (n) return n;
  const e = String(email ?? "").trim();
  if (e) return e;
  return fallback;
}
