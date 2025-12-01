"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

type RestaurantDocStatus = "pending" | "approved" | "rejected";
type RestaurantDocType = "logo" | "business_license" | "other";

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

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

export default function AdminRestaurantsPage() {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [rows, setRows] = useState<RestaurantAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      setOk(null);

      // 🔹 Vérifier utilisateur + rôle admin
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        if (!cancelled) setErr(userError.message);
        setLoading(false);
        return;
      }

      if (!user) {
        if (!cancelled) {
          setErr("Tu dois te connecter en admin.");
          router.push("/auth/login");
        }
        setLoading(false);
        return;
      }

      const adminUid = user.id;
      setAdminId(adminUid);

      const { data: me, error: meError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", adminUid)
        .maybeSingle();

      if (meError) {
        if (!cancelled) setErr(meError.message);
        setLoading(false);
        return;
      }

      if (!me || me.role !== "admin") {
        if (!cancelled) {
          setErr("Accès réservé aux administrateurs.");
        }
        setLoading(false);
        return;
      }

      // 🔹 Charger les profils restaurant
      const { data: restaurantProfiles, error: rpError } = await supabase
        .from("restaurant_profiles")
        .select(
          "user_id, restaurant_name, phone, email, address, city, postal_code, cuisine_type, license_number, tax_id, website, instagram, facebook, offers_delivery, offers_pickup, offers_dine_in, opening_hours"
        )
        .order("created_at", { ascending: false });

      if (rpError) {
        if (!cancelled) setErr(rpError.message);
        setLoading(false);
        return;
      }

      if (!restaurantProfiles || restaurantProfiles.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const userIds = restaurantProfiles.map((r: any) => r.user_id);

      // 🔹 Charger profils (nom complet du contact)
      const { data: profilesRows, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) {
        if (!cancelled) setErr(profilesError.message);
        setLoading(false);
        return;
      }

      const profileById = new Map<
        string,
        { full_name: string | null; email: string | null }
      >();
      profilesRows?.forEach((p: any) => {
        profileById.set(p.id, {
          full_name: p.full_name ?? null,
          email: p.email ?? null,
        });
      });

      // 🔹 Charger les documents restaurant
      const { data: docsRowsRaw, error: docsError } = await supabase
        .from("restaurant_documents")
        .select(
          "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes"
        )
        .in("user_id", userIds);

      if (docsError) {
        if (!cancelled) setErr(docsError.message);
        setLoading(false);
        return;
      }

      // 🔹 Générer URL signée pour les images
      const docsRows: RestaurantDocumentRow[] = await Promise.all(
        (docsRowsRaw || []).map(async (row: any) => {
          const doc: RestaurantDocumentRow = {
            id: row.id,
            user_id: row.user_id,
            doc_type: row.doc_type,
            status: row.status,
            file_path: row.file_path,
            created_at: row.created_at,
            reviewed_at: row.reviewed_at,
            review_notes: row.review_notes,
          };

          const isImg = isImagePath(doc.file_path);
          doc._isImage = isImg;

          if (isImg) {
            const { data, error } = await supabase.storage
              .from("restaurant-docs")
              .createSignedUrl(doc.file_path, 60 * 60);

            if (!error && data?.signedUrl) {
              doc._signedUrl = data.signedUrl;
            }
          }

          return doc;
        })
      );

      const docsByUser = new Map<string, RestaurantDocumentRow[]>();
      docsRows.forEach((row) => {
        if (!docsByUser.has(row.user_id)) {
          docsByUser.set(row.user_id, []);
        }
        docsByUser.get(row.user_id)!.push(row);
      });

      // 🔹 Fusionner tout
      const merged: RestaurantAdminRow[] = restaurantProfiles.map((r: any) => {
        const profileInfo = profileById.get(r.user_id) ?? {
          full_name: null,
          email: null,
        };

        let opening: OpeningHours | null = null;
        if (r.opening_hours && typeof r.opening_hours === "object") {
          opening = {} as OpeningHours;
          (Object.keys(DAY_LABELS) as DayKey[]).forEach((day) => {
            const d = (r.opening_hours as any)[day];
            if (d && typeof d.open === "string" && typeof d.close === "string") {
              opening![day] = { open: d.open, close: d.close };
            } else {
              opening![day] = null;
            }
          });
        }

        return {
          user_id: r.user_id,
          restaurant_name: r.restaurant_name ?? "Restaurant sans nom",
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
          offers_delivery: !!r.offers_delivery,
          offers_pickup: !!r.offers_pickup,
          offers_dine_in: !!r.offers_dine_in,
          opening_hours: opening,
          documents: docsByUser.get(r.user_id) ?? [],
        };
      });

      if (!cancelled) {
        setRows(merged);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function getGlobalStatus(documents: RestaurantDocumentRow[]): RestaurantDocStatus {
    if (!documents.length) return "pending";
    if (documents.some((d) => d.status === "rejected")) return "rejected";
    if (documents.every((d) => d.status === "approved")) return "approved";
    return "pending";
  }

  async function updateRestaurantStatus(
    targetUserId: string,
    newStatus: RestaurantDocStatus
  ) {
    if (!adminId) return;
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const { error } = await supabase
        .from("restaurant_documents")
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminId,
        })
        .eq("user_id", targetUserId);

      if (error) {
        setErr(error.message);
        setUpdatingUserId(null);
        return;
      }

      setOk(
        newStatus === "approved"
          ? "Restaurant approuvé ✅"
          : newStatus === "rejected"
          ? "Restaurant refusé ❌"
          : "Statut mis à jour"
      );

      setRows((prev) =>
        prev.map((r) =>
          r.user_id === targetUserId
            ? {
                ...r,
                documents: r.documents.map((d) => ({
                  ...d,
                  status: newStatus,
                  reviewed_at: new Date().toISOString(),
                })),
              }
            : r
        )
      );
    } catch (e: any) {
      setErr(e.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdatingUserId(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Restaurants — vérification admin</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (err && !rows.length) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Restaurants — vérification admin</h1>
        <p className="text-red-600 text-sm">{err}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Restaurants — vérification admin</h1>

      {err && <p className="text-red-600 text-sm">{err}</p>}
      {ok && <p className="text-green-600 text-sm">{ok}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          Aucun profil restaurant enregistré pour le moment.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const status = getGlobalStatus(r.documents);
            const isPending = status === "pending";
            const isApproved = status === "approved";
            const isRejected = status === "rejected";

            return (
              <div
                key={r.user_id}
                className="border rounded-lg p-4 space-y-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {r.restaurant_name}
                    </h2>
                    <p className="text-sm text-gray-700">
                      Contact : {r.contact_name || "—"}
                    </p>
                    <p className="text-sm text-gray-600">
                      Email contact : {r.contact_email || "—"}
                    </p>
                    <p className="text-sm text-gray-600">
                      Email restaurant : {r.restaurant_email || "—"}
                    </p>
                    <p className="text-sm text-gray-600">
                      📞 {r.phone || "Téléphone inconnu"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        isApproved
                          ? "bg-green-100 text-green-800"
                          : isRejected
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {isApproved
                        ? "Approuvé"
                        : isRejected
                        ? "Refusé"
                        : "En attente"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <p>
                      <span className="font-medium">Adresse : </span>
                      {r.address || "—"},{" "}
                      {r.city || ""} {r.postal_code || ""}
                    </p>
                    <p>
                      <span className="font-medium">Type de cuisine : </span>
                      {r.cuisine_type || "—"}
                    </p>
                    <p>
                      <span className="font-medium">Options : </span>
                      {r.offers_delivery ? "Livraison" : ""}
                      {r.offers_pickup ? (r.offers_delivery ? " • " : "") + "À emporter" : ""}
                      {r.offers_dine_in
                        ? (r.offers_delivery || r.offers_pickup ? " • " : "") +
                          "Sur place"
                        : ""}
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
                      {r.website ? (
                        <a
                          href={r.website}
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
                      {r.instagram ? (
                        <a
                          href={r.instagram}
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
                      {r.facebook ? (
                        <a
                          href={r.facebook}
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

                {/* Horaires rapide */}
                {r.opening_hours && (
                  <div className="border-t pt-3 text-xs text-gray-700 space-y-1">
                    <p className="font-semibold text-sm">
                      Horaires d’ouverture
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1">
                      {(Object.keys(DAY_LABELS) as DayKey[]).map((day) => {
                        const slot = r.opening_hours![day];
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

                {/* Documents */}
                <div className="border-t pt-3 space-y-2 text-sm">
                  <p className="font-semibold">Documents :</p>
                  {r.documents.length === 0 ? (
                    <p className="text-gray-600">
                      Aucun document envoyé pour l’instant.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {r.documents.map((d) => (
                        <li
                          key={d.id}
                          className="flex flex-col sm:flex-row sm:items-center gap-2"
                        >
                          <div className="w-40 text-xs font-medium">
                            {d.doc_type === "logo"
                              ? "Logo"
                              : d.doc_type === "business_license"
                              ? "Licence / Business doc"
                              : "Autre document"}
                          </div>

                          {d._isImage && d._signedUrl ? (
                            <div className="flex items-center gap-2">
                              <img
                                src={d._signedUrl}
                                alt={d.doc_type}
                                className="w-20 h-20 object-cover rounded border"
                              />
                              <a
                                href={d._signedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-blue-600 underline"
                              >
                                Ouvrir
                              </a>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 truncate max-w-xs">
                                {d.file_path}
                              </span>
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
                            </div>
                          )}

                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                              d.status === "approved"
                                ? "bg-green-100 text-green-800"
                                : d.status === "rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {d.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Boutons Approuver / Refuser */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={updatingUserId === r.user_id}
                    onClick={() =>
                      updateRestaurantStatus(r.user_id, "approved")
                    }
                    className="px-3 py-1 rounded text-sm bg-green-600 text-white disabled:opacity-60"
                  >
                    {updatingUserId === r.user_id
                      ? "Validation…"
                      : "Approuver"}
                  </button>
                  <button
                    type="button"
                    disabled={updatingUserId === r.user_id}
                    onClick={() =>
                      updateRestaurantStatus(r.user_id, "rejected")
                    }
                    className="px-3 py-1 rounded text-sm bg-red-600 text-white disabled:opacity-60"
                  >
                    {updatingUserId === r.user_id ? "Traitement…" : "Refuser"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
