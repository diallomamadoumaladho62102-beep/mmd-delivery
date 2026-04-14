"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canReviewDrivers } from "@/lib/adminAccess";

type VehicleType =
  | "bike"
  | "ebike"
  | "scooter"
  | "motorbike"
  | "car"
  | "other";

type DocType = "profile_photo" | "driver_license" | "id_card";
type ReviewStatus = "pending" | "approved" | "rejected";

type ReviewDriverRole = Parameters<typeof canReviewDrivers>[0];

type DriverProfileRow = {
  user_id: string;
  phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  vehicle_type: VehicleType | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  status: string | null;
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
  date_of_birth: string | null;
  address: string | null;
  vehicle_type: VehicleType | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  status: ReviewStatus;
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
  message?: string;
  error?: string;
};

function isReviewDriverRole(value: string | null): value is ReviewDriverRole {
  return (
    typeof value === "string" &&
    canReviewDrivers(value as ReviewDriverRole)
  );
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

function normalizeDriverStatus(
  value: string | null | undefined
): ReviewStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

function normalizeVehicleType(
  value: VehicleType | null | undefined
): VehicleType {
  return value ?? "other";
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

function getTimestamp(value: string | null | undefined): number {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortDocuments(documents: DriverDocumentRow[]): DriverDocumentRow[] {
  return [...documents].sort(
    (a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at)
  );
}

function labelForDocType(docType: DocType): string {
  switch (docType) {
    case "profile_photo":
      return "Photo de profil";
    case "driver_license":
      return "Permis";
    case "id_card":
      return "ID / Passeport";
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

async function buildSignedDocument(
  row: Omit<DriverDocumentRow, "_signedUrl" | "_isImage">
): Promise<DriverDocumentRow> {
  const doc: DriverDocumentRow = {
    ...row,
    _signedUrl: null,
    _isImage: isImagePath(row.file_path),
  };

  if (!row.file_path) {
    return doc;
  }

  const { data, error } = await supabase.storage
    .from("driver-docs")
    .createSignedUrl(row.file_path, 60 * 60);

  if (!error && data?.signedUrl) {
    doc._signedUrl = data.signedUrl;
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
            "user_id, phone, date_of_birth, address, vehicle_type, vehicle_brand, vehicle_model, vehicle_year, vehicle_color, plate_number, status"
          )
          .order("created_at", { ascending: false });

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
            "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes"
          )
          .in("user_id", userIds);

        if (docsError) {
          throw new Error(docsError.message);
        }

        const docsRows = await Promise.all(
          ((docsRowsRaw ?? []) as Omit<
            DriverDocumentRow,
            "_signedUrl" | "_isImage"
          >[]).map((row) => buildSignedDocument(row))
        );

        const docsByUser = new Map<string, DriverDocumentRow[]>();

        docsRows.forEach((row) => {
          const existing = docsByUser.get(row.user_id) ?? [];
          existing.push(row);
          docsByUser.set(row.user_id, existing);
        });

        const merged: DriverAdminRow[] = typedDriverProfiles.map((d) => {
          const profileInfo = profileById.get(d.user_id) ?? {
            full_name: null,
            email: null,
          };

          return {
            user_id: d.user_id,
            full_name: profileInfo.full_name,
            email: profileInfo.email,
            phone: d.phone,
            date_of_birth: d.date_of_birth,
            address: d.address,
            vehicle_type: normalizeVehicleType(d.vehicle_type),
            vehicle_brand: d.vehicle_brand,
            vehicle_model: d.vehicle_model,
            vehicle_year: d.vehicle_year,
            vehicle_color: d.vehicle_color,
            plate_number: d.plate_number,
            status: normalizeDriverStatus(d.status),
            documents: sortDocuments(docsByUser.get(d.user_id) ?? []),
          };
        });

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
    [router]
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
    newStatus: Extract<ReviewStatus, "approved" | "rejected">
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
          json.error || "Erreur lors de la mise à jour du chauffeur"
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
            : "Chauffeur refusé ❌")
      );

      setRows((prev) =>
        prev.map((r) =>
          r.user_id === targetUserId
            ? {
                ...r,
                status: newStatus,
                documents: sortDocuments(
                  r.documents.map((d) => ({
                    ...d,
                    status: newStatus,
                    reviewed_at: reviewedAt,
                    review_notes: normalizedReviewNotes,
                  }))
                ),
              }
            : r
        )
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
    [rows]
  );

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === "pending").length,
    [rows]
  );

  const rejectedCount = useMemo(
    () => rows.filter((r) => r.status === "rejected").length,
    [rows]
  );

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold">Chauffeurs — Admin</h1>
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
            <h1 className="mb-4 text-2xl font-bold">Chauffeurs — Admin</h1>
            <p className="text-sm text-red-600">{err}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <header className="space-y-3">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Admin Drivers
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Chauffeurs — vérification admin
          </h1>

          <p className="text-sm text-slate-600">
            Vérifie les profils chauffeurs, leurs documents et approuve ou refuse
            les candidatures.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Total chauffeurs</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {totalDrivers}
            </div>
          </div>

          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Approuvés</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {approvedCount}
            </div>
          </div>

          <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">En attente</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {pendingCount}
            </div>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="text-sm text-slate-500">Refusés</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {rejectedCount}
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
              const isApproved = status === "approved";
              const isRejected = status === "rejected";
              const reviewNote = noteDrafts[r.user_id] ?? "";

              return (
                <section
                  key={r.user_id}
                  className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {r.full_name || "Nom inconnu"}
                      </h2>
                      <p className="text-sm text-slate-600">
                        {r.email || "Email inconnu"}
                      </p>
                      <p className="text-sm text-slate-600">
                        📞 {r.phone || "Téléphone inconnu"}
                      </p>
                    </div>

                    <div>
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                          isApproved
                            ? "border-green-200 bg-green-100 text-green-800"
                            : isRejected
                            ? "border-red-200 bg-red-100 text-red-800"
                            : "border-yellow-200 bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {statusLabel(status)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">Date de naissance : </span>
                        {r.date_of_birth || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Adresse : </span>
                        {r.address || "—"}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">Véhicule : </span>
                        {normalizeVehicleType(r.vehicle_type).toUpperCase()}
                        {r.vehicle_brand ? ` • ${r.vehicle_brand}` : ""}
                        {r.vehicle_model ? ` • ${r.vehicle_model}` : ""}
                      </p>
                      <p>
                        <span className="font-medium">Année / couleur : </span>
                        {r.vehicle_year || "—"} / {r.vehicle_color || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Plaque : </span>
                        {r.plate_number || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-slate-200 pt-4 text-sm">
                    <p className="font-semibold text-slate-900">Documents</p>

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
                                      alt={d.doc_type}
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
                                      {d.file_path}
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
                                  d.status
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

                  <div className="space-y-3 border-t border-slate-200 pt-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
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
                        rows={3}
                        placeholder="Ajouter une note interne pour cette review..."
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={updatingUserId === r.user_id}
                        onClick={() =>
                          void updateDriverStatus(r.user_id, "approved")
                        }
                        className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:opacity-60"
                      >
                        {updatingUserId === r.user_id
                          ? "Validation…"
                          : "Approuver"}
                      </button>

                      <button
                        type="button"
                        disabled={updatingUserId === r.user_id}
                        onClick={() =>
                          void updateDriverStatus(r.user_id, "rejected")
                        }
                        className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
                      >
                        {updatingUserId === r.user_id
                          ? "Traitement…"
                          : "Refuser"}
                      </button>
                    </div>
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