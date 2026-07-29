/**
 * Canonical Driver setup / readiness helpers.
 * Single source of truth aligned with server gates:
 * - vehicle: driver_profiles.active_vehicle_id (car/moto)
 * - payout: driver_profiles.stripe_onboarded (after check_connect_status)
 */

export const DRIVER_REQUIRED_MOTOR_DOCS = [
  "license_front",
  "license_back",
  "insurance",
  "registration",
] as const;

export type DriverTransportMode = "bike" | "moto" | "car" | string | null | undefined;

export type DriverSetupDocRow = {
  doc_type?: string | null;
  status?: string | null;
};

export type DriverSetupProfileInput = {
  transport_mode?: DriverTransportMode;
  active_vehicle_id?: string | null;
  stripe_onboarded?: boolean | null;
};

export function normalizeDriverDocType(raw: unknown): string {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (v === "driver_license" || v === "license" || v === "permis") return "license_front";
  if (v === "driver_license_back" || v === "license_verso") return "license_back";
  if (v === "vehicle_registration" || v === "carte_grise") return "registration";
  if (v === "assurance" || v === "insurance_doc") return "insurance";
  return v;
}

export function isApprovedDriverDocStatus(status: unknown): boolean {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  // Missing status is NOT approved — avoids false readiness.
  return s === "approved" || s === "verified" || s === "valid";
}

export function isBikeTransportMode(mode: DriverTransportMode): boolean {
  return String(mode ?? "")
    .trim()
    .toLowerCase() === "bike";
}

export function needsMotorVehicle(mode: DriverTransportMode): boolean {
  const m = String(mode ?? "")
    .trim()
    .toLowerCase();
  return m === "car" || m === "moto";
}

export function isVehicleSetupOk(
  profile: Pick<DriverSetupProfileInput, "transport_mode" | "active_vehicle_id">,
): boolean {
  if (!needsMotorVehicle(profile.transport_mode)) return true;
  return Boolean(String(profile.active_vehicle_id ?? "").trim());
}

/** Payout ready via stripe_onboarded only. */
export function isPayoutSetupOk(
  profile: Pick<DriverSetupProfileInput, "stripe_onboarded">,
): boolean {
  return Boolean(profile.stripe_onboarded);
}

export function countApprovedMotorDocs(docs: DriverSetupDocRow[]): {
  docsDone: number;
  docsTotal: number;
} {
  const approved = new Set(
    (docs ?? [])
      .filter((row) => isApprovedDriverDocStatus(row.status))
      .map((row) => normalizeDriverDocType(row.doc_type))
      .filter(Boolean),
  );

  // license_front may be satisfied by legacy driver_license mapping already,
  // or by having license_back + legacy combined — also accept license_back as
  // satisfying front only when license_front or driver_license present via normalize.
  if (approved.has("license_back") || approved.has("driver_license")) {
    approved.add("license_front");
  }

  const docsTotal = DRIVER_REQUIRED_MOTOR_DOCS.length;
  const docsDone = DRIVER_REQUIRED_MOTOR_DOCS.filter((d) => approved.has(d)).length;
  return { docsDone, docsTotal };
}

export type DriverSetupProgress = {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;
  isBike: boolean;
  needsVehicle: boolean;
};

/**
 * Unified Account / WorkAccount progress:
 * vehicle 25 + docs 50 + payout 25.
 * Bike: docs treated as complete (50 pts).
 */
export function computeDriverSetupProgress(input: {
  profile: DriverSetupProfileInput;
  docs: DriverSetupDocRow[];
}): DriverSetupProgress {
  const isBike = isBikeTransportMode(input.profile.transport_mode);
  const needsVehicle = needsMotorVehicle(input.profile.transport_mode);
  const vehicleOk = isVehicleSetupOk(input.profile);
  const payoutOk = isPayoutSetupOk(input.profile);

  let docsDone = 0;
  let docsTotal = 0;
  if (isBike) {
    docsDone = 1;
    docsTotal = 1;
  } else {
    const counted = countApprovedMotorDocs(input.docs);
    docsDone = counted.docsDone;
    docsTotal = counted.docsTotal;
  }

  const docsScore = docsTotal > 0 ? Math.round((docsDone / docsTotal) * 50) : 0;
  const progress = Math.max(
    0,
    Math.min(100, (vehicleOk ? 25 : 0) + docsScore + (payoutOk ? 25 : 0)),
  );

  return {
    progress,
    vehicleOk,
    docsDone,
    docsTotal,
    payoutOk,
    isBike,
    needsVehicle,
  };
}

export function nextDriverSetupStep(
  progress: Pick<DriverSetupProgress, "vehicleOk" | "docsDone" | "docsTotal" | "payoutOk" | "isBike">,
): "addVehicle" | "addDocs" | "setupPayment" | "ready" {
  if (!progress.vehicleOk) return "addVehicle";
  if (!progress.isBike && progress.docsDone < progress.docsTotal) return "addDocs";
  if (!progress.payoutOk) return "setupPayment";
  return "ready";
}
