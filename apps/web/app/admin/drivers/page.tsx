"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canReviewDrivers } from "@/lib/adminAccess";

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

type ReviewStatus = "pending" | "approved" | "rejected";

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
  status?: "approved" | "rejected";
  reviewedAt?: string;
  reviewNotes?: string | null;
  documentsRequired?: boolean;
  missingRequirements?: string[];
  missingRequirementsText?: string | null;
  isOnline?: boolean;
  message?: string;
  error?: string;
};

function isReviewDriverRole(value: string | null): value is ReviewDriverRole {
  return typeof value === "string" && canReviewDrivers(value as ReviewDriverRole);
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

function normalizeDriverStatus(
  value: string | null | undefined,
): ReviewStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function normalizeVehicleType(
  value: string | null | undefined,
): VehicleType {
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

function parseMissingRequirements(
  text: string | null | undefined,
): string[] {
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
    case "pending":
    default:
      return "border-slate-200 bg-white";
  }
}

function getPriorityScore(row: DriverAdminRow): number {
  if (row.status === "pending" && row.documents.length === 0) return 0;
  if (row.status === "pending" && row.documents_required) return 1;
  if (row.status === "pending") return 2;
  if (row.status === "rejected") return 3;
  if (row.status === "approved" && row.documents_required) return 4;
  return 5;
}

function getDriverInsight(row: DriverAdminRow): {
  label: string;
  className: string;
} {
  if (row.documents.length === 0) {
    return {
      label: "Aucun document reçu",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (row.documents_required) {
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

  const bucketsToTry = ["avatars", "driver-docs"];

  for (const bucket of bucketsToTry) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(row.file_path, 60 * 60);

    if (!error && data?.signedUrl) {
      doc._signedUrl = data.signedUrl;
      return doc;
    }
  }

  return doc;
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

        if (!me || !isReviewDriverRole(me.role)) {
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

        const typedDriverProfiles = (driverProfiles ?? []) as DriverProfileRow[];

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
          ((docsRowsRaw ?? []) as Omit<
            DriverDocumentRow,
            "_signedUrl" | "_isImage"
          >[]).map((row) => buildSignedDocument(row)),
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
              transport_mode: normalizeVehicleType(
                d.transport_mode ?? d.vehicle_type,
              ),
              vehicle_brand: d.vehicle_brand,
              vehicle_model: d.vehicle_model,
              vehicle_year: d.vehicle_year,
              vehicle_color: d.vehicle_color,
              plate_number: d.plate_number,
              license_number: d.license_number,
              license_expiry: d.license_expiry,
              status: normalizeDriverStatus(d.status),
              documents_required: Boolean(d.documents_required),
              missing_requirements: d.missing_requirements ?? null,
              is_online: Boolean(d.is_online),
              documents: sortDocuments(docsByUser.get(d.user_id) ?? []),
            };
          })
          .sort((a, b) => getPriorityScore(a) - getPriorityScore(b));

        if (!cancelledRef?.cancelled) {
          setRows(merged);

          const initialDrafts: Record<string, string> = {};
          merged.forEach((row) => {
            initialDrafts[row.user_id] = getLatestReviewNote(row.documents);
          });
          setNoteDrafts(initialDrafts);
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
    newStatus: Extract<ReviewStatus, "approved" | "rejected">,
  ) {
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const reviewNotes = (noteDrafts[targetUserId] ?? "").trim();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      if (!session?.access_token) {
        throw new Error("Session utilisateur introuvable");
      }

      const response = await fetch("/api/admin/drivers/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
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
            : "Chauffeur refusé ❌"),
      );

      setRows((prev) =>
        prev
          .map((r) =>
            r.user_id === targetUserId
              ? {
                  ...r,
                  status: newStatus,
                  documents_required:
                    typeof json.documentsRequired === "boolean"
                      ? json.documentsRequired
                      : r.documents_required,
                  missing_requirements:
                    typeof json.missingRequirementsText === "string" ||
                    json.missingRequirementsText === null
                      ? json.missingRequirementsText ?? null
                      : r.missing_requirements,
                  is_online:
                    typeof json.isOnline === "boolean"
                      ? json.isOnline
                      : false,
                  documents: sortDocuments(
                    r.documents.map((d) => ({
                      ...d,
                      status: newStatus,
                      reviewed_at: reviewedAt,
                      review_notes: normalizedReviewNotes,
                    })),
                  ),
                }
              : r,
          )
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

  const incompleteCount = useMemo(
    () => rows.filter((r) => r.documents_required).length,
    [rows],
  );

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
            Vérifie les profils chauffeurs, leurs documents et indique clairement
            les informations manquantes avant validation.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-600">
              Aucun profil chauffeur enregistré pour le moment.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => {
              const status = r.status;
              const insight = getDriverInsight(r);
              const reviewNote = noteDrafts[r.user_id] ?? "";
              const missingList = parseMissingRequirements(r.missing_requirements);

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

                          {r.documents_required && (
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
                            <span className="font-medium">Téléphone urgence :</span>{" "}
                            {r.emergency_phone || "—"}
                          </p>
                          <p className="break-all">
                            <span className="font-medium">Email :</span>{" "}
                            {r.email || "—"}
                          </p>
                          <p>
                            <span className="font-medium">Date de naissance :</span>{" "}
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
                            {[r.city, r.state, r.zip_code].filter(Boolean).join(" • ") || "—"}
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
                            L’API recalculera automatiquement les documents et champs manquants.
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <button
                              type="button"
                              disabled={updatingUserId === r.user_id}
                              onClick={() =>
                                void updateDriverStatus(r.user_id, "approved")
                              }
                              style={{
                                minHeight: "54px",
                                width: "100%",
                                borderRadius: "12px",
                                backgroundColor: "#16a34a",
                                color: "#ffffff",
                                border: "2px solid #166534",
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                              }}
                            >
                              {updatingUserId === r.user_id
                                ? "Validation..."
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
                              <span className="font-medium">Mode de transport :</span>{" "}
                              {formatVehicleType(r.transport_mode)}
                            </p>
                            <p>
                              <span className="font-medium">Marque / modèle :</span>{" "}
                              {[r.vehicle_brand, r.vehicle_model]
                                .filter(Boolean)
                                .join(" • ") || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Email :</span>{" "}
                              {r.email || "—"}
                            </p>
                            <p>
                              <span className="font-medium">Téléphone urgence :</span>{" "}
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
                              <span className="font-medium">Permis / expiration :</span>{" "}
                              {[r.license_number, r.license_expiry]
                                .filter(Boolean)
                                .join(" • ") || "—"}
                            </p>
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
                                            {d.file_path || "Fichier indisponible"}
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

                                    <span
                                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClassForStatus(
                                        d.status,
                                      )}`}
                                    >
                                      {statusLabel(d.status)}
                                    </span>
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
                            Cette note peut expliquer au chauffeur ce qu’il doit corriger ou compléter.
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