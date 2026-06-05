"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canReviewDrivers, canViewDrivers } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { supabase } from "@/lib/supabaseBrowser";

type VehicleType = "bike" | "moto" | "car" | "other";

type DocType =
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

type ReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | "disabled";

type DriverActionStatus = "approved" | "rejected" | "suspended" | "disabled";

type ReviewDriverRole = Parameters<typeof canReviewDrivers>[0];

type DriverProfileRow = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  transport_mode: string | null;
  vehicle_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  status: string | null;
  documents_required: boolean | null;
  missing_requirements: string | null;
  is_online: boolean | null;
};

type DriverDocumentRow = {
  id: string;
  user_id: string;
  doc_type: DocType;
  status: ReviewStatus;
  file_path: string;
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  _signedUrl?: string | null;
  _isImage?: boolean;
};

type DriverAdminRow = {
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
  status: ReviewStatus;
  documents_required: boolean;
  missing_requirements: string | null;
  computed_missing_requirements: string[];
  is_online: boolean;
  documents: DriverDocumentRow[];
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AdminRoleRow = {
  id: string;
  role: string | null;
};

type ReviewDriverApiResponse = {
  ok: boolean;
  userId?: string;
  status?: DriverActionStatus;
  reviewedAt?: string;
  reviewNotes?: string | null;
  documentsRequired?: boolean;
  missingRequirements?: string[];
  missingRequirementsText?: string | null;
  isOnline?: boolean;
  message?: string;
  error?: string;
};

type UpdateDriverProfileApiResponse = {
  ok: boolean;
  userId?: string;
  updatedFields?: string[];
  message?: string;
  error?: string;
};

type UpdateDriverDocumentApiResponse = {
  ok: boolean;
  userId?: string;
  documentId?: string;
  deleted?: boolean;
  document?: Partial<DriverDocumentRow>;
  message?: string;
  error?: string;
};

type DriverProfileDraft = {
  full_name: string;
  phone: string;
  emergency_phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  date_of_birth: string;
  transport_mode: VehicleType;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_year: string;
  vehicle_color: string;
  plate_number: string;
  license_number: string;
  license_expiry: string;
};

const DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 60;

const DRIVER_DOCUMENT_BUCKETS = [
  "driver-documents",
  "driver-docs",
  "avatars",
] as const;

function isReviewDriverRole(value: string | null): value is ReviewDriverRole {
  return (
    typeof value === "string" && canReviewDrivers(value as ReviewDriverRole)
  );
}

function canAccessDriversPage(value: string | null): boolean {
  return typeof value === "string" && canViewDrivers(value as ReviewDriverRole);
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

function normalizeDriverStatus(value: string | null | undefined): ReviewStatus {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "incomplete" ||
    value === "suspended" ||
    value === "disabled"
  ) {
    return value;
  }

  return "pending";
}

function normalizeVehicleType(value: string | null | undefined): VehicleType {
  if (value === "bike" || value === "moto" || value === "car") return value;
  return "other";
}

function formatVehicleType(value: string | null | undefined): string {
  const v = normalizeVehicleType(value);
  if (v === "bike") return "Bike";
  if (v === "moto") return "Moto";
  if (v === "car") return "Car";
  return "Other";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
  }).format(date);
}

function getTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortDocuments(documents: DriverDocumentRow[]): DriverDocumentRow[] {
  return [...documents].sort(
    (a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at),
  );
}

function labelForDocType(docType: DocType): string {
  switch (docType) {
    case "profile_photo":
      return "Photo personnelle";
    case "id_card_front":
      return "ID recto";
    case "id_card_back":
      return "ID verso";
    case "license_front":
      return "Permis recto";
    case "license_back":
      return "Permis verso";
    case "insurance":
      return "Assurance";
    case "registration":
      return "Registration";
    case "driver_license":
      return "Permis (ancien format)";
    case "id_card":
      return "ID (ancien format)";
    case "passport":
      return "Passeport";
    case "other":
      return "Autre document";
    default:
      return docType;
  }
}

function badgeClassForStatus(status: ReviewStatus): string {
  switch (status) {
    case "approved":
      return "border-green-200 bg-green-100 text-green-800";
    case "rejected":
      return "border-red-200 bg-red-100 text-red-800";
    case "incomplete":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "suspended":
      return "border-orange-200 bg-orange-100 text-orange-800";
    case "disabled":
      return "border-slate-300 bg-slate-200 text-slate-800";
    case "pending":
    default:
      return "border-yellow-200 bg-yellow-100 text-yellow-800";
  }
}

function statusLabel(status: ReviewStatus): string {
  switch (status) {
    case "approved":
      return "Approuvé";
    case "rejected":
      return "Refusé";
    case "incomplete":
      return "Incomplet";
    case "suspended":
      return "Suspendu";
    case "disabled":
      return "Désactivé";
    case "pending":
    default:
      return "En attente";
  }
}

function getLatestReviewNote(documents: DriverDocumentRow[]): string {
  const withNotes = documents
    .filter((d) => (d.review_notes?.trim() ?? "").length > 0)
    .sort((a, b) => {
      const aTime = getTimestamp(a.reviewed_at ?? a.created_at);
      const bTime = getTimestamp(b.reviewed_at ?? b.created_at);
      return bTime - aTime;
    });

  return withNotes[0]?.review_notes?.trim() ?? "";
}

function parseMissingRequirements(text: string | null | undefined): string[] {
  if (!text) return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  const withoutPrefix = trimmed.replace(/^Missing:\s*/i, "");
  return withoutPrefix
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getActionCardClass(status: ReviewStatus): string {
  switch (status) {
    case "approved":
      return "border-green-200 bg-green-50";
    case "rejected":
      return "border-red-200 bg-red-50";
    case "incomplete":
      return "border-amber-200 bg-amber-50";
    case "suspended":
      return "border-orange-200 bg-orange-50";
    case "disabled":
      return "border-slate-300 bg-slate-100";
    case "pending":
    default:
      return "border-slate-200 bg-white";
  }
}

function computeMissingRequirementsForRow(input: {
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
  documents: DriverDocumentRow[];
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

function getPriorityScore(row: DriverAdminRow): number {
  if (row.status === "disabled") return 8;
  if (row.status === "suspended") return 7;
  if (row.documents.length === 0) return 0;
  if (
    row.computed_missing_requirements.length > 0 ||
    row.status === "incomplete"
  )
    return 1;
  if (row.status === "pending") return 2;
  if (row.status === "rejected") return 3;
  if (row.status === "approved" && row.documents_required) return 4;
  return 5;
}

function getDriverInsight(row: DriverAdminRow): {
  label: string;
  className: string;
} {
  if (row.status === "disabled") {
    return {
      label: "Compte désactivé",
      className: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }

  if (row.status === "suspended") {
    return {
      label: "Compte suspendu",
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }

  if (row.documents.length === 0) {
    return {
      label: "Aucun document reçu",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (row.computed_missing_requirements.length > 0) {
    return {
      label: "Éléments manquants",
      className: "border-yellow-200 bg-yellow-50 text-yellow-700",
    };
  }

  if (row.status === "approved") {
    return {
      label: "Dossier validé",
      className: "border-green-200 bg-green-50 text-green-700",
    };
  }

  if (row.status === "rejected") {
    return {
      label: "Dossier refusé",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  return {
    label: "Prêt pour vérification",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  };
}

async function buildSignedDocument(
  row: Omit<DriverDocumentRow, "_signedUrl" | "_isImage">,
): Promise<DriverDocumentRow> {
  const doc: DriverDocumentRow = {
    ...row,
    _signedUrl: null,
    _isImage: isImagePath(row.file_path),
  };

  if (!row.file_path) {
    return doc;
  }

  for (const bucket of DRIVER_DOCUMENT_BUCKETS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(row.file_path, DOCUMENT_SIGNED_URL_TTL_SECONDS);

    if (!error && data?.signedUrl) {
      doc._signedUrl = data.signedUrl;
      return doc;
    }
  }

  return doc;
}

function buildProfileDraft(row: DriverAdminRow): DriverProfileDraft {
  return {
    full_name: row.full_name ?? "",
    phone: row.phone ?? "",
    emergency_phone: row.emergency_phone ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip_code: row.zip_code ?? "",
    date_of_birth: row.date_of_birth ?? "",
    transport_mode: row.transport_mode === "other" ? "car" : row.transport_mode,
    vehicle_brand: row.vehicle_brand ?? "",
    vehicle_model: row.vehicle_model ?? "",
    vehicle_year: row.vehicle_year == null ? "" : String(row.vehicle_year),
    vehicle_color: row.vehicle_color ?? "",
    plate_number: row.plate_number ?? "",
    license_number: row.license_number ?? "",
    license_expiry: row.license_expiry ?? "",
  };
}

export default function AdminDriversPage() {
  const router = useRouter();

  const [rows, setRows] = useState<DriverAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [profileDrafts, setProfileDrafts] = useState<
    Record<string, DriverProfileDraft>
  >({});
  const [documentStatusDrafts, setDocumentStatusDrafts] = useState<
    Record<string, ReviewStatus>
  >({});
  const [documentNoteDrafts, setDocumentNoteDrafts] = useState<
    Record<string, string>
  >({});
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");

  const loadPage = useCallback(
    async (cancelledRef?: { cancelled: boolean }) => {
      try {
        setLoading(true);
        setErr(null);
        setOk(null);

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          throw new Error(userError.message);
        }

        if (!user) {
          if (!cancelledRef?.cancelled) {
            setAuthChecked(true);
            setIsAdmin(false);
            setErr("Tu dois te connecter en admin.");
            router.push("/auth/login");
          }
          return;
        }

        const { data: me, error: meError } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("id", user.id)
          .maybeSingle<AdminRoleRow>();

        if (meError) {
          throw new Error(meError.message);
        }

        if (!me || !canAccessDriversPage(me.role)) {
          if (!cancelledRef?.cancelled) {
            setAuthChecked(true);
            setIsAdmin(false);
            setErr("Accès réservé aux administrateurs.");
          }
          return;
        }

        if (!cancelledRef?.cancelled) {
          setAuthChecked(true);
          setIsAdmin(true);
        }

        const { data: driverProfiles, error: dpError } = await supabase
          .from("driver_profiles")
          .select(
            `
            user_id,
            full_name,
            phone,
            emergency_phone,
            date_of_birth,
            address,
            city,
            state,
            zip_code,
            transport_mode,
            vehicle_type,
            vehicle_brand,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            plate_number,
            license_number,
            license_expiry,
            status,
            documents_required,
            missing_requirements,
            is_online
          `,
          )
          .order("updated_at", { ascending: false });

        if (dpError) {
          throw new Error(dpError.message);
        }

        const typedDriverProfiles = (driverProfiles ??
          []) as DriverProfileRow[];

        if (typedDriverProfiles.length === 0) {
          if (!cancelledRef?.cancelled) {
            setRows([]);
            setNoteDrafts({});
          }
          return;
        }

        const userIds = typedDriverProfiles.map((d) => d.user_id);

        const { data: profilesRows, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);

        if (profilesError) {
          throw new Error(profilesError.message);
        }

        const profileById = new Map<
          string,
          { full_name: string | null; email: string | null }
        >();

        ((profilesRows ?? []) as ProfileRow[]).forEach((p) => {
          profileById.set(p.id, {
            full_name: p.full_name ?? null,
            email: p.email ?? null,
          });
        });

        const { data: docsRowsRaw, error: docsError } = await supabase
          .from("driver_documents")
          .select(
            "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes",
          )
          .in("user_id", userIds);

        if (docsError) {
          throw new Error(docsError.message);
        }

        const docsRows = await Promise.all(
          (
            (docsRowsRaw ?? []) as Omit<
              DriverDocumentRow,
              "_signedUrl" | "_isImage"
            >[]
          ).map((row) => buildSignedDocument(row)),
        );

        const docsByUser = new Map<string, DriverDocumentRow[]>();

        docsRows.forEach((row) => {
          const existing = docsByUser.get(row.user_id) ?? [];
          existing.push(row);
          docsByUser.set(row.user_id, existing);
        });

        const merged: DriverAdminRow[] = typedDriverProfiles
          .map((d) => {
            const profileInfo = profileById.get(d.user_id) ?? {
              full_name: d.full_name ?? null,
              email: null,
            };

            const transportMode = normalizeVehicleType(
              d.transport_mode ?? d.vehicle_type,
            );
            const documents = sortDocuments(docsByUser.get(d.user_id) ?? []);
            const computedMissingRequirements =
              computeMissingRequirementsForRow({
                transport_mode: transportMode,
                full_name: d.full_name ?? profileInfo.full_name ?? null,
                phone: d.phone,
                emergency_phone: d.emergency_phone,
                address: d.address,
                city: d.city,
                state: d.state,
                zip_code: d.zip_code,
                date_of_birth: d.date_of_birth,
                vehicle_brand: d.vehicle_brand,
                vehicle_model: d.vehicle_model,
                vehicle_year: d.vehicle_year,
                vehicle_color: d.vehicle_color,
                plate_number: d.plate_number,
                license_number: d.license_number,
                license_expiry: d.license_expiry,
                documents,
              });

            const fallbackMissing = parseMissingRequirements(
              d.missing_requirements ?? null,
            );

            return {
              user_id: d.user_id,
              full_name: d.full_name ?? profileInfo.full_name,
              email: profileInfo.email,
              phone: d.phone,
              emergency_phone: d.emergency_phone,
              date_of_birth: d.date_of_birth,
              address: d.address,
              city: d.city,
              state: d.state,
              zip_code: d.zip_code,
              transport_mode: transportMode,
              vehicle_brand: d.vehicle_brand,
              vehicle_model: d.vehicle_model,
              vehicle_year: d.vehicle_year,
              vehicle_color: d.vehicle_color,
              plate_number: d.plate_number,
              license_number: d.license_number,
              license_expiry: d.license_expiry,
              status: normalizeDriverStatus(d.status),
              documents_required: computedMissingRequirements.length > 0,
              missing_requirements:
                computedMissingRequirements.length > 0
                  ? computedMissingRequirements.join(", ")
                  : (d.missing_requirements ?? null),
              computed_missing_requirements:
                computedMissingRequirements.length > 0
                  ? computedMissingRequirements
                  : fallbackMissing,
              is_online: Boolean(d.is_online),
              documents,
            };
          })
          .sort((a, b) => getPriorityScore(a) - getPriorityScore(b));

        if (!cancelledRef?.cancelled) {
          setRows(merged);

          const initialDrafts: Record<string, string> = {};
          const initialProfileDrafts: Record<string, DriverProfileDraft> = {};
          const initialDocumentStatusDrafts: Record<string, ReviewStatus> = {};
          const initialDocumentNoteDrafts: Record<string, string> = {};

          merged.forEach((row) => {
            initialDrafts[row.user_id] = getLatestReviewNote(row.documents);
            initialProfileDrafts[row.user_id] = buildProfileDraft(row);

            row.documents.forEach((doc) => {
              initialDocumentStatusDrafts[doc.id] = doc.status;
              initialDocumentNoteDrafts[doc.id] = doc.review_notes ?? "";
            });
          });

          setNoteDrafts(initialDrafts);
          setProfileDrafts(initialProfileDrafts);
          setDocumentStatusDrafts(initialDocumentStatusDrafts);
          setDocumentNoteDrafts(initialDocumentNoteDrafts);
        }
      } catch (e: unknown) {
        if (!cancelledRef?.cancelled) {
          const message =
            e instanceof Error ? e.message : "Erreur lors du chargement";
          setErr(message);
        }
      } finally {
        if (!cancelledRef?.cancelled) {
          setLoading(false);
        }
      }
    },
    [router],
  );

  useEffect(() => {
    const cancelledRef = { cancelled: false };
    void loadPage(cancelledRef);

    return () => {
      cancelledRef.cancelled = true;
    };
  }, [loadPage]);

  async function updateDriverStatus(
    targetUserId: string,
    newStatus: DriverActionStatus,
  ) {
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const reviewNotes = (noteDrafts[targetUserId] ?? "").trim();
      const targetRow = rows.find((row) => row.user_id === targetUserId);

      if (!targetRow) {
        throw new Error("Chauffeur introuvable dans la liste actuelle.");
      }

      if (
        newStatus === "approved" &&
        targetRow.computed_missing_requirements.length > 0
      ) {
        setErr(
          "Impossible d’approuver ce chauffeur : il manque encore des informations ou documents obligatoires.",
        );
        return;
      }

      const response = await adminFetch("/api/admin/drivers/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUserId,
          status: newStatus,
          reviewNotes,
        }),
      });

      const json = (await response.json()) as ReviewDriverApiResponse;

      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || "Erreur lors de la mise à jour du chauffeur",
        );
      }

      const reviewedAt = json.reviewedAt ?? new Date().toISOString();
      const returnedReviewNotes =
        typeof json.reviewNotes === "string" ? json.reviewNotes : reviewNotes;
      const normalizedReviewNotes =
        returnedReviewNotes.trim().length > 0
          ? returnedReviewNotes.trim()
          : null;

      setOk(
        json.message ||
          (newStatus === "approved"
            ? "Chauffeur approuvé ✅"
            : newStatus === "rejected"
              ? "Chauffeur refusé ❌"
              : newStatus === "suspended"
                ? "Chauffeur suspendu ⚠️"
                : "Chauffeur désactivé 🚫"),
      );

      setRows((prev) =>
        prev
          .map((r) => {
            if (r.user_id !== targetUserId) return r;

            const updatedDocuments = sortDocuments(
              newStatus === "approved" || newStatus === "rejected"
                ? r.documents.map((d) => ({
                    ...d,
                    status: newStatus,
                    reviewed_at: reviewedAt,
                    review_notes: normalizedReviewNotes,
                  }))
                : r.documents,
            );

            const computedMissingRequirements =
              computeMissingRequirementsForRow({
                transport_mode: r.transport_mode,
                full_name: r.full_name,
                phone: r.phone,
                emergency_phone: r.emergency_phone,
                address: r.address,
                city: r.city,
                state: r.state,
                zip_code: r.zip_code,
                date_of_birth: r.date_of_birth,
                vehicle_brand: r.vehicle_brand,
                vehicle_model: r.vehicle_model,
                vehicle_year: r.vehicle_year,
                vehicle_color: r.vehicle_color,
                plate_number: r.plate_number,
                license_number: r.license_number,
                license_expiry: r.license_expiry,
                documents: updatedDocuments,
              });

            return {
              ...r,
              status: newStatus,
              documents_required:
                typeof json.documentsRequired === "boolean"
                  ? json.documentsRequired
                  : computedMissingRequirements.length > 0,
              missing_requirements:
                typeof json.missingRequirementsText === "string" ||
                json.missingRequirementsText === null
                  ? (json.missingRequirementsText ?? null)
                  : computedMissingRequirements.join(", "),
              computed_missing_requirements: Array.isArray(
                json.missingRequirements,
              )
                ? json.missingRequirements
                : computedMissingRequirements,
              is_online:
                typeof json.isOnline === "boolean" ? json.isOnline : false,
              documents: updatedDocuments,
            };
          })
          .sort((a, b) => getPriorityScore(a) - getPriorityScore(b)),
      );

      setNoteDrafts((prev) => ({
        ...prev,
        [targetUserId]: normalizedReviewNotes ?? "",
      }));
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Erreur lors de la mise à jour";
      setErr(message);
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function updateDriverProfile(targetUserId: string) {
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const draft = profileDrafts[targetUserId];
      if (!draft)
        throw new Error("Profil chauffeur introuvable dans le formulaire.");

      const response = await adminFetch("/api/admin/drivers/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetUserId, profile: draft }),
      });

      const json = (await response.json()) as UpdateDriverProfileApiResponse;
      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || "Erreur lors de la modification du profil chauffeur",
        );
      }

      setRows((prev) =>
        prev.map((row) => {
          if (row.user_id !== targetUserId) return row;

          const vehicleYear = draft.vehicle_year.trim()
            ? Number(draft.vehicle_year.trim())
            : null;

          const updatedRow: DriverAdminRow = {
            ...row,
            full_name: draft.full_name.trim() || null,
            phone: draft.phone.trim() || null,
            emergency_phone: draft.emergency_phone.trim() || null,
            address: draft.address.trim() || null,
            city: draft.city.trim() || null,
            state: draft.state.trim().toUpperCase() || null,
            zip_code: draft.zip_code.trim() || null,
            date_of_birth: draft.date_of_birth.trim() || null,
            transport_mode: draft.transport_mode,
            vehicle_brand: draft.vehicle_brand.trim() || null,
            vehicle_model: draft.vehicle_model.trim() || null,
            vehicle_year: Number.isFinite(vehicleYear) ? vehicleYear : null,
            vehicle_color: draft.vehicle_color.trim() || null,
            plate_number: draft.plate_number.trim().toUpperCase() || null,
            license_number: draft.license_number.trim().toUpperCase() || null,
            license_expiry: draft.license_expiry.trim() || null,
          };

          return {
            ...updatedRow,
            computed_missing_requirements: computeMissingRequirementsForRow({
              transport_mode: updatedRow.transport_mode,
              full_name: updatedRow.full_name,
              phone: updatedRow.phone,
              emergency_phone: updatedRow.emergency_phone,
              address: updatedRow.address,
              city: updatedRow.city,
              state: updatedRow.state,
              zip_code: updatedRow.zip_code,
              date_of_birth: updatedRow.date_of_birth,
              vehicle_brand: updatedRow.vehicle_brand,
              vehicle_model: updatedRow.vehicle_model,
              vehicle_year: updatedRow.vehicle_year,
              vehicle_color: updatedRow.vehicle_color,
              plate_number: updatedRow.plate_number,
              license_number: updatedRow.license_number,
              license_expiry: updatedRow.license_expiry,
              documents: updatedRow.documents,
            }),
          };
        }),
      );

      setOk(json.message || "Profil chauffeur modifié avec succès ✅");
    } catch (e: unknown) {
      setErr(
        e instanceof Error
          ? e.message
          : "Erreur lors de la modification du profil",
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function updateDriverDocument(params: {
    userId: string;
    documentId: string;
  }) {
    const { userId, documentId } = params;
    setUpdatingDocumentId(documentId);
    setErr(null);
    setOk(null);

    try {
      const status = documentStatusDrafts[documentId] ?? "pending";
      const reviewNotes = (documentNoteDrafts[documentId] ?? "").trim();

      const response = await adminFetch("/api/admin/drivers/update-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          documentId,
          status,
          reviewNotes,
        }),
      });

      const json = (await response.json()) as UpdateDriverDocumentApiResponse;
      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || "Erreur lors de la modification du document",
        );
      }

      setRows((prev) =>
        prev.map((row) => {
          if (row.user_id !== userId) return row;

          const documents = sortDocuments(
            row.documents.map((doc) =>
              doc.id === documentId
                ? {
                    ...doc,
                    status,
                    reviewed_at:
                      typeof json.document?.reviewed_at === "string"
                        ? json.document.reviewed_at
                        : new Date().toISOString(),
                    review_notes: reviewNotes.length > 0 ? reviewNotes : null,
                  }
                : doc,
            ),
          );

          return {
            ...row,
            documents,
            computed_missing_requirements: computeMissingRequirementsForRow({
              transport_mode: row.transport_mode,
              full_name: row.full_name,
              phone: row.phone,
              emergency_phone: row.emergency_phone,
              address: row.address,
              city: row.city,
              state: row.state,
              zip_code: row.zip_code,
              date_of_birth: row.date_of_birth,
              vehicle_brand: row.vehicle_brand,
              vehicle_model: row.vehicle_model,
              vehicle_year: row.vehicle_year,
              vehicle_color: row.vehicle_color,
              plate_number: row.plate_number,
              license_number: row.license_number,
              license_expiry: row.license_expiry,
              documents,
            }),
          };
        }),
      );

      setOk(json.message || "Document chauffeur modifié avec succès ✅");
    } catch (e: unknown) {
      setErr(
        e instanceof Error
          ? e.message
          : "Erreur lors de la modification du document",
      );
    } finally {
      setUpdatingDocumentId(null);
    }
  }

  async function deleteDriverDocument(params: {
    userId: string;
    documentId: string;
  }) {
    const { userId, documentId } = params;

    if (
      !window.confirm(
        "Supprimer ce document chauffeur ? Cette action est réservée aux admins.",
      )
    ) {
      return;
    }

    setUpdatingDocumentId(documentId);
    setErr(null);
    setOk(null);

    try {
      const reviewNotes = (documentNoteDrafts[documentId] ?? "").trim();

      const response = await adminFetch("/api/admin/drivers/update-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          documentId,
          reviewNotes,
          deleteDocument: true,
        }),
      });

      const json = (await response.json()) as UpdateDriverDocumentApiResponse;
      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || "Erreur lors de la suppression du document",
        );
      }

      setRows((prev) =>
        prev.map((row) => {
          if (row.user_id !== userId) return row;
          const documents = row.documents.filter(
            (doc) => doc.id !== documentId,
          );

          return {
            ...row,
            documents,
            computed_missing_requirements: computeMissingRequirementsForRow({
              transport_mode: row.transport_mode,
              full_name: row.full_name,
              phone: row.phone,
              emergency_phone: row.emergency_phone,
              address: row.address,
              city: row.city,
              state: row.state,
              zip_code: row.zip_code,
              date_of_birth: row.date_of_birth,
              vehicle_brand: row.vehicle_brand,
              vehicle_model: row.vehicle_model,
              vehicle_year: row.vehicle_year,
              vehicle_color: row.vehicle_color,
              plate_number: row.plate_number,
              license_number: row.license_number,
              license_expiry: row.license_expiry,
              documents,
            }),
          };
        }),
      );

      setDocumentStatusDrafts((prev) => {
        const next = { ...prev };
        delete next[documentId];
        return next;
      });
      setDocumentNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[documentId];
        return next;
      });

      setOk(json.message || "Document chauffeur supprimé avec succès ✅");
    } catch (e: unknown) {
      setErr(
        e instanceof Error
          ? e.message
          : "Erreur lors de la suppression du document",
      );
    } finally {
      setUpdatingDocumentId(null);
    }
  }

  const totalDrivers = rows.length;

  const approvedCount = useMemo(
    () => rows.filter((r) => r.status === "approved").length,
    [rows],
  );

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "pending").length,
    [rows],
  );

  const rejectedCount = useMemo(
    () => rows.filter((r) => r.status === "rejected").length,
    [rows],
  );

  const suspendedCount = useMemo(
    () => rows.filter((r) => r.status === "suspended").length,
    [rows],
  );

  const disabledCount = useMemo(
    () => rows.filter((r) => r.status === "disabled").length,
    [rows],
  );

  const incompleteCount = useMemo(
    () => rows.filter((r) => r.computed_missing_requirements.length > 0).length,
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesStatus =
        statusFilter === "all" ? true : row.status === statusFilter;

      if (!matchesStatus) return false;
      if (!query) return true;

      const searchable = [
        row.full_name,
        row.email,
        row.phone,
        row.emergency_phone,
        row.city,
        row.state,
        row.zip_code,
        row.transport_mode,
        row.plate_number,
        row.license_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [rows, searchQuery, statusFilter]);

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold">
              Chauffeurs — vérification admin
            </h1>
            <p className="text-sm text-slate-600">Chargement…</p>
          </div>
        </div>
      </main>
    );
  }

  if ((!isAdmin || err) && !rows.length) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold">
              Chauffeurs — vérification admin
            </h1>
            <p className="text-sm text-red-600">{err}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-screen-xl space-y-6 px-6 py-6">
        <header className="space-y-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Admin Drivers
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Chauffeurs — vérification admin
          </h1>

          <p className="text-sm text-slate-600">
            Vérifie les profils chauffeurs, leurs documents et indique
            clairement les informations manquantes avant validation.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-7">
          <div className="min-h-[132px] rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-slate-500">
              Total chauffeurs
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-slate-900">
              {totalDrivers}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-green-200 bg-green-50 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-green-700">
              Approuvés
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-green-900">
              {approvedCount}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-yellow-700">
              En attente
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-yellow-900">
              {pendingCount}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-red-700">
              Refusés
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-red-900">
              {rejectedCount}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-amber-700">
              Incomplets
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-amber-900">
              {incompleteCount}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-orange-200 bg-orange-50 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-orange-700">
              Suspendus
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-orange-900">
              {suspendedCount}
            </div>
          </div>

          <div className="min-h-[132px] rounded-2xl border border-slate-300 bg-slate-100 p-6 text-center shadow-sm flex flex-col items-center justify-center">
            <div className="text-sm font-medium leading-none text-slate-700">
              Désactivés
            </div>
            <div className="mt-4 text-5xl font-extrabold tracking-tight leading-none text-slate-900">
              {disabledCount}
            </div>
          </div>
        </section>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {err}
          </div>
        )}

        {ok && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 shadow-sm">
            {ok}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Rechercher par nom, email, téléphone, ville, plaque..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as ReviewStatus | "all")
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="all">Tous les statuts</option>
              <option value="pending">En attente</option>
              <option value="approved">Approuvés</option>
              <option value="rejected">Refusés</option>
              <option value="incomplete">Incomplets</option>
              <option value="suspended">Suspendus</option>
              <option value="disabled">Désactivés</option>
            </select>
          </div>
        </section>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">
              Aucun profil chauffeur enregistré pour le moment.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">
              Aucun chauffeur ne correspond à ce filtre.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRows.map((r) => {
              const status = r.status;
              const insight = getDriverInsight(r);
              const reviewNote = noteDrafts[r.user_id] ?? "";
              const missingList = r.computed_missing_requirements;

              return (
                <section
                  key={r.user_id}
                  className={`rounded-2xl border p-6 shadow-sm ${getActionCardClass(
                    status,
                  )}`}
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-center">
                      <div className="min-w-0 space-y-5 rounded-2xl border border-slate-100 bg-white/70 p-6 xl:pr-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-slate-900">
                            {r.full_name || "Nom inconnu"}
                          </h2>

                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${badgeClassForStatus(
                              status,
                            )}`}
                          >
                            {statusLabel(status)}
                          </span>

                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${insight.className}`}
                          >
                            {insight.label}
                          </span>

                          {r.computed_missing_requirements.length > 0 && (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                              Documents requis
                            </span>
                          )}

                          {r.is_online ? (
                            <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                              En ligne
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                              Hors ligne
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
                          <p>
                            <span className="font-medium">Nom :</span>{" "}
                            {r.full_name || "—"}
                          </p>
                          <p>
                            <span className="font-medium">Téléphone :</span>{" "}
                            {r.phone || "—"}
                          </p>
                          <p>
                            <span className="font-medium">
                              Téléphone urgence :
                            </span>{" "}
                            {r.emergency_phone || "—"}
                          </p>
                          <p className="break-all">
                            <span className="font-medium">Email :</span>{" "}
                            {r.email || "—"}
                          </p>
                          <p>
                            <span className="font-medium">
                              Date de naissance :
                            </span>{" "}
                            {formatBirthDate(r.date_of_birth)}
                          </p>
                          <p>
                            <span className="font-medium">Mode :</span>{" "}
                            {formatVehicleType(r.transport_mode)}
                          </p>
                        </div>

                        <div className="text-sm text-slate-600 space-y-1">
                          <p>
                            <span className="font-medium text-slate-700">
                              Adresse :
                            </span>{" "}
                            {r.address || "—"}
                          </p>
                          <p>
                            <span className="font-medium text-slate-700">
                              Ville / État / ZIP :
                            </span>{" "}
                            {[r.city, r.state, r.zip_code]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-600 space-y-1">
                          <p>
                            <span className="font-medium text-slate-700">
                              Véhicule :
                            </span>{" "}
                            {formatVehicleType(r.transport_mode)}
                            {r.vehicle_brand ? ` • ${r.vehicle_brand}` : ""}
                            {r.vehicle_model ? ` • ${r.vehicle_model}` : ""}
                          </p>
                          <p>
                            <span className="font-medium text-slate-700">
                              Année / Couleur / Plaque :
                            </span>{" "}
                            {[r.vehicle_year, r.vehicle_color, r.plate_number]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </p>
                          <p>
                            <span className="font-medium text-slate-700">
                              Permis :
                            </span>{" "}
                            {[r.license_number, r.license_expiry]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </p>
                        </div>
                      </div>

                      <div className="w-full rounded-2xl border border-slate-100 bg-white/70 p-5 flex flex-col justify-center">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-3 text-sm font-semibold text-slate-900">
                            Actions rapides
                          </div>

                          <div className="text-xs text-slate-600 mb-4">
                            L’API recalculera automatiquement les documents et
                            champs manquants.
                          </div>

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <button
                              type="button"
                              disabled={
                                updatingUserId === r.user_id ||
                                missingList.length > 0
                              }
                              title={
                                missingList.length > 0
                                  ? "Complète d’abord les informations/documents manquants."
                                  : "Approuver ce chauffeur"
                              }
                              onClick={() =>
                                void updateDriverStatus(r.user_id, "approved")
                              }
                              style={{
                                minHeight: "54px",
                                width: "100%",
                                borderRadius: "12px",
                                backgroundColor:
                                  missingList.length > 0
                                    ? "#94a3b8"
                                    : "#16a34a",
                                color: "#ffffff",
                                border:
                                  missingList.length > 0
                                    ? "2px solid #64748b"
                                    : "2px solid #166534",
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                                cursor:
                                  missingList.length > 0
                                    ? "not-allowed"
                                    : "pointer",
                              }}
                            >
                              {updatingUserId === r.user_id
                                ? "Validation..."
                                : missingList.length > 0
                                  ? "Incomplet"
                                  : "Approuver"}
                            </button>

                            <button
                              type="button"
                              disabled={updatingUserId === r.user_id}
                              onClick={() =>
                                void updateDriverStatus(r.user_id, "rejected")
                              }
                              style={{
                                minHeight: "54px",
                                width: "100%",
                                borderRadius: "12px",
                                backgroundColor: "#dc2626",
                                color: "#ffffff",
                                border: "2px solid #991b1b",
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              }}
                            >
                              {updatingUserId === r.user_id
                                ? "Traitement..."
                                : "Refuser"}
                            </button>

                            <button
                              type="button"
                              disabled={updatingUserId === r.user_id}
                              onClick={() =>
                                void updateDriverStatus(r.user_id, "suspended")
                              }
                              style={{
                                minHeight: "54px",
                                width: "100%",
                                borderRadius: "12px",
                                backgroundColor: "#ea580c",
                                color: "#ffffff",
                                border: "2px solid #9a3412",
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              }}
                            >
                              {updatingUserId === r.user_id
                                ? "Traitement..."
                                : "Suspendre"}
                            </button>

                            <button
                              type="button"
                              disabled={updatingUserId === r.user_id}
                              onClick={() =>
                                void updateDriverStatus(r.user_id, "disabled")
                              }
                              style={{
                                minHeight: "54px",
                                width: "100%",
                                borderRadius: "12px",
                                backgroundColor: "#334155",
                                color: "#ffffff",
                                border: "2px solid #0f172a",
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              }}
                            >
                              {updatingUserId === r.user_id
                                ? "Traitement..."
                                : "Désactiver"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <details className="rounded-2xl border border-slate-200 bg-white open:shadow-sm">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">
                        Voir les détails
                      </summary>

                      <div className="space-y-5 border-t border-slate-200 px-4 py-4">
                        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                          <div className="space-y-2">
                            <p>
                              <span className="font-medium">
                                Mode de transport :
                              </span>{" "}
                              {formatVehicleType(r.transport_mode)}
                            </p>
                            <p>
                              <span className="font-medium">
                                Marque / modèle :
                              </span>{" "}
                              {[r.vehicle_brand, r.vehicle_model]
                                .filter(Boolean)
                                .join(" • ") || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Email :</span>{" "}
                              {r.email || "—"}
                            </p>
                            <p>
                              <span className="font-medium">
                                Téléphone urgence :
                              </span>{" "}
                              {r.emergency_phone || "—"}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <p>
                              <span className="font-medium">Année :</span>{" "}
                              {r.vehicle_year || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Couleur :</span>{" "}
                              {r.vehicle_color || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Plaque :</span>{" "}
                              {r.plate_number || "—"}
                            </p>
                            <p>
                              <span className="font-medium">
                                Permis / expiration :
                              </span>{" "}
                              {[r.license_number, r.license_expiry]
                                .filter(Boolean)
                                .join(" • ") || "—"}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="font-semibold text-slate-900">
                              Modifier le profil chauffeur
                            </p>
                            <button
                              type="button"
                              disabled={updatingUserId === r.user_id}
                              onClick={() =>
                                void updateDriverProfile(r.user_id)
                              }
                              className="rounded-xl border border-blue-700 bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {updatingUserId === r.user_id
                                ? "Sauvegarde..."
                                : "Sauvegarder le profil"}
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {[
                              ["full_name", "Nom complet"],
                              ["phone", "Téléphone"],
                              ["emergency_phone", "Téléphone urgence"],
                              ["address", "Adresse"],
                              ["city", "Ville"],
                              ["state", "État"],
                              ["zip_code", "ZIP"],
                              ["date_of_birth", "Date naissance"],
                              ["vehicle_brand", "Marque"],
                              ["vehicle_model", "Modèle"],
                              ["vehicle_year", "Année"],
                              ["vehicle_color", "Couleur"],
                              ["plate_number", "Plaque"],
                              ["license_number", "Permis"],
                              ["license_expiry", "Expiration permis"],
                            ].map(([field, label]) => (
                              <label key={field} className="space-y-1">
                                <span className="text-xs font-semibold text-slate-600">
                                  {label}
                                </span>
                                <input
                                  value={String(
                                    profileDrafts[r.user_id]?.[
                                      field as keyof DriverProfileDraft
                                    ] ?? "",
                                  )}
                                  onChange={(event) =>
                                    setProfileDrafts((prev) => ({
                                      ...prev,
                                      [r.user_id]: {
                                        ...(prev[r.user_id] ??
                                          buildProfileDraft(r)),
                                        [field]: event.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                />
                              </label>
                            ))}

                            <label className="space-y-1">
                              <span className="text-xs font-semibold text-slate-600">
                                Mode transport
                              </span>
                              <select
                                value={
                                  profileDrafts[r.user_id]?.transport_mode ??
                                  r.transport_mode
                                }
                                onChange={(event) =>
                                  setProfileDrafts((prev) => ({
                                    ...prev,
                                    [r.user_id]: {
                                      ...(prev[r.user_id] ??
                                        buildProfileDraft(r)),
                                      transport_mode: event.target
                                        .value as VehicleType,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                              >
                                <option value="bike">Bike</option>
                                <option value="moto">Moto</option>
                                <option value="car">Car</option>
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="space-y-3 text-sm">
                          <p className="font-semibold text-slate-900">
                            Éléments manquants signalés au chauffeur
                          </p>

                          {missingList.length === 0 ? (
                            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-green-700">
                              Aucun élément manquant enregistré.
                            </div>
                          ) : (
                            <ul className="space-y-2">
                              {missingList.map((item) => (
                                <li
                                  key={item}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
                                >
                                  {item}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="space-y-3 text-sm">
                          <p className="font-semibold text-slate-900">
                            Documents
                          </p>

                          {r.documents.length === 0 ? (
                            <p className="text-slate-600">
                              Aucun document envoyé pour l’instant.
                            </p>
                          ) : (
                            <ul className="space-y-3">
                              {r.documents.map((d) => (
                                <li
                                  key={d.id}
                                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="space-y-2">
                                      <div className="text-xs font-semibold text-slate-700">
                                        {labelForDocType(d.doc_type)}
                                      </div>

                                      {d._isImage && d._signedUrl ? (
                                        <div className="flex items-center gap-3">
                                          <img
                                            src={d._signedUrl}
                                            alt={labelForDocType(d.doc_type)}
                                            className="h-20 w-20 rounded border bg-white object-cover"
                                          />
                                          <div className="space-y-1">
                                            <a
                                              href={d._signedUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-xs text-blue-600 underline"
                                            >
                                              Ouvrir
                                            </a>
                                            <div className="text-xs text-slate-500">
                                              Créé : {formatDate(d.created_at)}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                              Revu : {formatDate(d.reviewed_at)}
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-1">
                                          <div className="max-w-xl truncate text-xs text-slate-600">
                                            {d.file_path ||
                                              "Fichier indisponible"}
                                          </div>

                                          {d._signedUrl && (
                                            <a
                                              href={d._signedUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-xs text-blue-600 underline"
                                            >
                                              Ouvrir
                                            </a>
                                          )}

                                          <div className="text-xs text-slate-500">
                                            Créé : {formatDate(d.created_at)}
                                          </div>
                                          <div className="text-xs text-slate-500">
                                            Revu : {formatDate(d.reviewed_at)}
                                          </div>
                                        </div>
                                      )}

                                      {d.review_notes ? (
                                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                          {d.review_notes}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="min-w-[220px] space-y-3">
                                      <span
                                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClassForStatus(
                                          d.status,
                                        )}`}
                                      >
                                        {statusLabel(d.status)}
                                      </span>

                                      <select
                                        value={
                                          documentStatusDrafts[d.id] ?? d.status
                                        }
                                        onChange={(event) =>
                                          setDocumentStatusDrafts((prev) => ({
                                            ...prev,
                                            [d.id]: event.target
                                              .value as ReviewStatus,
                                          }))
                                        }
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                      >
                                        <option value="pending">
                                          En attente
                                        </option>
                                        <option value="approved">
                                          Approuvé
                                        </option>
                                        <option value="rejected">Refusé</option>
                                        <option value="incomplete">
                                          Incomplet
                                        </option>
                                      </select>

                                      <textarea
                                        value={documentNoteDrafts[d.id] ?? ""}
                                        onChange={(event) =>
                                          setDocumentNoteDrafts((prev) => ({
                                            ...prev,
                                            [d.id]: event.target.value,
                                          }))
                                        }
                                        rows={3}
                                        placeholder="Note document..."
                                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                                      />

                                      <div className="grid grid-cols-2 gap-2">
                                        <button
                                          type="button"
                                          disabled={updatingDocumentId === d.id}
                                          onClick={() =>
                                            void updateDriverDocument({
                                              userId: r.user_id,
                                              documentId: d.id,
                                            })
                                          }
                                          className="rounded-xl border border-blue-700 bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          {updatingDocumentId === d.id
                                            ? "..."
                                            : "Sauver"}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={updatingDocumentId === d.id}
                                          onClick={() =>
                                            void deleteDriverDocument({
                                              userId: r.user_id,
                                              documentId: d.id,
                                            })
                                          }
                                          className="rounded-xl border border-red-700 bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          Supprimer
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-slate-700">
                            Note admin
                          </label>
                          <textarea
                            value={reviewNote}
                            onChange={(e) =>
                              setNoteDrafts((prev) => ({
                                ...prev,
                                [r.user_id]: e.target.value,
                              }))
                            }
                            rows={4}
                            placeholder="Ajouter une note qui accompagnera la review..."
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          />
                          <p className="text-xs text-slate-500">
                            Cette note peut expliquer au chauffeur ce qu’il doit
                            corriger ou compléter.
                          </p>
                        </div>
                      </div>
                    </details>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
