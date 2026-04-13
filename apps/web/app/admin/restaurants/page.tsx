"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { canReviewRestaurants } from "@/lib/adminAccess";

type RestaurantDocStatus = "pending" | "approved" | "rejected";
type RestaurantDocType = "logo" | "business_license" | "other";
type ReviewRestaurantRole = Parameters<typeof canReviewRestaurants>[0];

type RestaurantDocumentRow = {
  id: string;
  user_id: string;
  doc_type: RestaurantDocType;
  status: RestaurantDocStatus;
  file_path: string;
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  _signedUrl?: string | null;
  _isImage?: boolean;
};

type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type OpeningHours = Record<DayKey, { open: string; close: string } | null>;

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

type RestaurantAdminRow = {
  user_id: string;
  restaurant_name: string;
  contact_name: string | null;
  contact_email: string | null;
  restaurant_email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  cuisine_type: string | null;
  license_number: string | null;
  tax_id: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  offers_dine_in: boolean;
  opening_hours: OpeningHours | null;
  documents: RestaurantDocumentRow[];
};

type RestaurantProfileRow = {
  user_id: string;
  restaurant_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  cuisine_type: string | null;
  license_number: string | null;
  tax_id: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  offers_delivery: boolean | null;
  offers_pickup: boolean | null;
  offers_dine_in: boolean | null;
  opening_hours: unknown;
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

type ReviewRestaurantApiResponse = {
  ok: boolean;
  userId?: string;
  status?: "approved" | "rejected";
  reviewedAt?: string;
  reviewNotes?: string | null;
  message?: string;
  error?: string;
};

function isReviewRestaurantRole(
  value: string | null
): value is ReviewRestaurantRole {
  return (
    typeof value === "string" &&
    canReviewRestaurants(value as ReviewRestaurantRole)
  );
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
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

function sortDocuments(
  documents: RestaurantDocumentRow[]
): RestaurantDocumentRow[] {
  return [...documents].sort(
    (a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at)
  );
}

function labelForDocType(docType: RestaurantDocType): string {
  switch (docType) {
    case "logo":
      return "Logo";
    case "business_license":
      return "Licence / Business doc";
    case "other":
    default:
      return "Autre document";
  }
}

function badgeClassForStatus(status: RestaurantDocStatus): string {
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

function statusLabel(status: RestaurantDocStatus): string {
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

function getGlobalStatus(
  documents: RestaurantDocumentRow[]
): RestaurantDocStatus {
  if (!documents.length) return "pending";
  if (documents.some((d) => d.status === "rejected")) return "rejected";
  if (documents.every((d) => d.status === "approved")) return "approved";
  return "pending";
}

function safeExternalHref(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeOpeningHours(value: unknown): OpeningHours | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const opening = {} as OpeningHours;

  (Object.keys(DAY_LABELS) as DayKey[]).forEach((day) => {
    const slot = (value as Record<string, unknown>)[day];

    if (
      slot &&
      typeof slot === "object" &&
      typeof (slot as { open?: unknown }).open === "string" &&
      typeof (slot as { close?: unknown }).close === "string"
    ) {
      opening[day] = {
        open: (slot as { open: string }).open,
        close: (slot as { close: string }).close,
      };
    } else {
      opening[day] = null;
    }
  });

  return opening;
}

function getLatestReviewNote(documents: RestaurantDocumentRow[]): string {
  const withNotes = documents
    .filter((d) => (d.review_notes?.trim() ?? "").length > 0)
    .sort((a, b) => {
      const aTime = getTimestamp(a.reviewed_at ?? a.created_at);
      const bTime = getTimestamp(b.reviewed_at ?? b.created_at);
      return bTime - aTime;
    });

  return withNotes[0]?.review_notes?.trim() ?? "";
}

function formatRestaurantAddress(
  row: Pick<RestaurantAdminRow, "address" | "city" | "postal_code">
): string {
  const parts = [
    row.address?.trim(),
    [row.city?.trim(), row.postal_code?.trim()].filter(Boolean).join(" "),
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "—";
}

async function buildSignedDocument(
  row: Omit<RestaurantDocumentRow, "_signedUrl" | "_isImage">
): Promise<RestaurantDocumentRow> {
  const doc: RestaurantDocumentRow = {
    ...row,
    _signedUrl: null,
    _isImage: isImagePath(row.file_path),
  };

  if (!row.file_path) {
    return doc;
  }

  const { data, error } = await supabase.storage
    .from("restaurant-docs")
    .createSignedUrl(row.file_path, 60 * 60);

  if (!error && data?.signedUrl) {
    doc._signedUrl = data.signedUrl;
  }

  return doc;
}

export default function AdminRestaurantsPage() {
  const router = useRouter();

  const [rows, setRows] = useState<RestaurantAdminRow[]>([]);
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
          .maybeSingle();

        if (meError) {
          throw new Error(meError.message);
        }

        const meRow = me as AdminRoleRow | null;

        if (!meRow || !isReviewRestaurantRole(meRow.role)) {
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

        const { data: restaurantProfiles, error: rpError } = await supabase
          .from("restaurant_profiles")
          .select(
            "user_id, restaurant_name, phone, email, address, city, postal_code, cuisine_type, license_number, tax_id, website, instagram, facebook, offers_delivery, offers_pickup, offers_dine_in, opening_hours"
          )
          .order("created_at", { ascending: false });

        if (rpError) {
          throw new Error(rpError.message);
        }

        const typedRestaurantProfiles =
          (restaurantProfiles ?? []) as RestaurantProfileRow[];

        if (typedRestaurantProfiles.length === 0) {
          if (!cancelledRef?.cancelled) {
            setRows([]);
            setNoteDrafts({});
          }
          return;
        }

        const userIds = typedRestaurantProfiles.map((r) => r.user_id);

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
          .from("restaurant_documents")
          .select(
            "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes"
          )
          .in("user_id", userIds);

        if (docsError) {
          throw new Error(docsError.message);
        }

        const docsRows = await Promise.all(
          ((docsRowsRaw ?? []) as Omit<
            RestaurantDocumentRow,
            "_signedUrl" | "_isImage"
          >[]).map((row) => buildSignedDocument(row))
        );

        const docsByUser = new Map<string, RestaurantDocumentRow[]>();

        docsRows.forEach((row) => {
          const existing = docsByUser.get(row.user_id) ?? [];
          existing.push(row);
          docsByUser.set(row.user_id, existing);
        });

        const merged: RestaurantAdminRow[] = typedRestaurantProfiles.map((r) => {
          const profileInfo = profileById.get(r.user_id) ?? {
            full_name: null,
            email: null,
          };

          return {
            user_id: r.user_id,
            restaurant_name: r.restaurant_name?.trim() || "Restaurant sans nom",
            contact_name: profileInfo.full_name,
            contact_email: profileInfo.email,
            restaurant_email: r.email ?? null,
            phone: r.phone ?? null,
            address: r.address ?? null,
            city: r.city ?? null,
            postal_code: r.postal_code ?? null,
            cuisine_type: r.cuisine_type ?? null,
            license_number: r.license_number ?? null,
            tax_id: r.tax_id ?? null,
            website: r.website ?? null,
            instagram: r.instagram ?? null,
            facebook: r.facebook ?? null,
            offers_delivery: Boolean(r.offers_delivery),
            offers_pickup: Boolean(r.offers_pickup),
            offers_dine_in: Boolean(r.offers_dine_in),
            opening_hours: normalizeOpeningHours(r.opening_hours),
            documents: sortDocuments(docsByUser.get(r.user_id) ?? []),
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

  async function updateRestaurantStatus(
    targetUserId: string,
    newStatus: Extract<RestaurantDocStatus, "approved" | "rejected">
  ) {
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const reviewNotes = (noteDrafts[targetUserId] ?? "").trim();

      const response = await fetch("/api/admin/restaurants/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: targetUserId,
          status: newStatus,
          reviewNotes,
        }),
      });

      const json = (await response.json()) as ReviewRestaurantApiResponse;

      if (!response.ok || !json.ok) {
        throw new Error(
          json.error || "Erreur lors de la mise à jour du restaurant"
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
            ? "Restaurant approuvé ✅"
            : "Restaurant refusé ❌")
      );

      setRows((prev) =>
        prev.map((r) =>
          r.user_id === targetUserId
            ? {
                ...r,
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

  const totalRestaurants = rows.length;

  const approvedCount = useMemo(
    () =>
      rows.filter((r) => getGlobalStatus(r.documents) === "approved").length,
    [rows]
  );

  const pendingCount = useMemo(
    () =>
      rows.filter((r) => getGlobalStatus(r.documents) === "pending").length,
    [rows]
  );

  const rejectedCount = useMemo(
    () =>
      rows.filter((r) => getGlobalStatus(r.documents) === "rejected").length,
    [rows]
  );

  if (loading || !authChecked) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-4 text-2xl font-bold">
              Restaurants — vérification admin
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
              Restaurants — vérification admin
            </h1>
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
            MMD Delivery · Admin Restaurants
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Restaurants — vérification admin
          </h1>

          <p className="text-sm text-slate-600">
            Vérifie les profils restaurants, leurs documents et approuve ou
            refuse les demandes.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Total restaurants</div>
            <div className="mt-2 text-3xl font-semibold text-slate-900">
              {totalRestaurants}
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
              Aucun profil restaurant enregistré pour le moment.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((r) => {
              const status = getGlobalStatus(r.documents);
              const isApproved = status === "approved";
              const isRejected = status === "rejected";

              const websiteHref = safeExternalHref(r.website);
              const instagramHref = safeExternalHref(r.instagram);
              const facebookHref = safeExternalHref(r.facebook);
              const reviewNote = noteDrafts[r.user_id] ?? "";

              return (
                <section
                  key={r.user_id}
                  className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {r.restaurant_name}
                      </h2>
                      <p className="text-sm text-slate-700">
                        Contact : {r.contact_name || "—"}
                      </p>
                      <p className="text-sm text-slate-600">
                        Email contact : {r.contact_email || "—"}
                      </p>
                      <p className="text-sm text-slate-600">
                        Email restaurant : {r.restaurant_email || "—"}
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

                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">Adresse : </span>
                        {formatRestaurantAddress(r)}
                      </p>
                      <p>
                        <span className="font-medium">Type de cuisine : </span>
                        {r.cuisine_type || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Options : </span>
                        {[
                          r.offers_delivery ? "Livraison" : null,
                          r.offers_pickup ? "À emporter" : null,
                          r.offers_dine_in ? "Sur place" : null,
                        ]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p>
                        <span className="font-medium">Licence : </span>
                        {r.license_number || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Tax ID (EIN) : </span>
                        {r.tax_id || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Site web : </span>
                        {websiteHref ? (
                          <a
                            href={websiteHref}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            {r.website}
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                      <p>
                        <span className="font-medium">Instagram : </span>
                        {instagramHref ? (
                          <a
                            href={instagramHref}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            Profil
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                      <p>
                        <span className="font-medium">Facebook : </span>
                        {facebookHref ? (
                          <a
                            href={facebookHref}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            Page
                          </a>
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>
                  </div>

                  {r.opening_hours && (
                    <div className="space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-700">
                      <p className="text-sm font-semibold text-slate-900">
                        Horaires d’ouverture
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                        {(Object.keys(DAY_LABELS) as DayKey[]).map((day) => {
                          const slot = r.opening_hours?.[day];
                          return (
                            <div key={day}>
                              <span className="font-medium">
                                {DAY_LABELS[day]} :{" "}
                              </span>
                              {slot && slot.open && slot.close
                                ? `${slot.open} – ${slot.close}`
                                : "—"}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

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

                    <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={updatingUserId === r.user_id}
                        onClick={() =>
                          void updateRestaurantStatus(r.user_id, "approved")
                        }
                        className="min-h-[48px] w-full rounded-xl border border-green-700 bg-green-600 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {updatingUserId === r.user_id
                          ? "Validation…"
                          : "✅ Approuver"}
                      </button>

                      <button
                        type="button"
                        disabled={updatingUserId === r.user_id}
                        onClick={() =>
                          void updateRestaurantStatus(r.user_id, "rejected")
                        }
                        className="min-h-[48px] w-full rounded-xl border border-red-700 bg-red-600 px-4 py-3 text-base font-semibold text-white shadow-md transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {updatingUserId === r.user_id
                          ? "Traitement…"
                          : "❌ Refuser"}
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