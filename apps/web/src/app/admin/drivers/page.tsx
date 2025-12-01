"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

type VehicleType = "bike" | "ebike" | "scooter" | "motorbike" | "car" | "other";
type DocType = "profile_photo" | "driver_license" | "id_card";
type DocStatus = "pending" | "approved" | "rejected";

type DriverProfileRow = {
  user_id: string;
  phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  vehicle_type: VehicleType;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
};

type DriverDocumentRow = {
  id: string;
  user_id: string;
  doc_type: DocType;
  status: DocStatus;
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
  vehicle_type: VehicleType;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  plate_number: string | null;
  documents: DriverDocumentRow[];
};

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(path);
}

export default function AdminDriversPage() {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [rows, setRows] = useState<DriverAdminRow[]>([]);
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

      // 🔹 Charger les profils chauffeur
      const { data: driverProfiles, error: dpError } = await supabase
        .from("driver_profiles")
        .select(
          "user_id, phone, date_of_birth, address, vehicle_type, vehicle_brand, vehicle_model, vehicle_year, vehicle_color, plate_number"
        )
        .order("created_at", { ascending: false });

      if (dpError) {
        if (!cancelled) setErr(dpError.message);
        setLoading(false);
        return;
      }

      if (!driverProfiles || driverProfiles.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const userIds = driverProfiles.map((d) => d.user_id);

      // 🔹 Charger noms / emails
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

      // 🔹 Charger les documents
      const { data: docsRowsRaw, error: docsError } = await supabase
        .from("driver_documents")
        .select(
          "id, user_id, doc_type, status, file_path, created_at, reviewed_at, review_notes"
        )
        .in("user_id", userIds);

      if (docsError) {
        if (!cancelled) setErr(docsError.message);
        setLoading(false);
        return;
      }

      // 🔹 Générer URL signée pour les images (photo, permis, ID)
      const docsRows: DriverDocumentRow[] = await Promise.all(
        (docsRowsRaw || []).map(async (row: any) => {
          const doc: DriverDocumentRow = {
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
              .from("driver-docs")
              .createSignedUrl(doc.file_path, 60 * 60); // 1h

            if (!error && data?.signedUrl) {
              doc._signedUrl = data.signedUrl;
            }
          }

          return doc;
        })
      );

      const docsByUser = new Map<string, DriverDocumentRow[]>();
      docsRows.forEach((row) => {
        if (!docsByUser.has(row.user_id)) {
          docsByUser.set(row.user_id, []);
        }
        docsByUser.get(row.user_id)!.push(row);
      });

      const merged: DriverAdminRow[] = driverProfiles.map((d: any) => {
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
          vehicle_type: d.vehicle_type,
          vehicle_brand: d.vehicle_brand,
          vehicle_model: d.vehicle_model,
          vehicle_year: d.vehicle_year,
          vehicle_color: d.vehicle_color,
          plate_number: d.plate_number,
          documents: docsByUser.get(d.user_id) ?? [],
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

  async function updateDriverStatus(
    targetUserId: string,
    newStatus: DocStatus
  ) {
    if (!adminId) return;
    setUpdatingUserId(targetUserId);
    setErr(null);
    setOk(null);

    try {
      const { error } = await supabase
        .from("driver_documents")
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
          ? "Chauffeur approuvé ✅"
          : "Chauffeur refusé ❌"
      );

      // Mettre à jour localement
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

  function getGlobalStatus(documents: DriverDocumentRow[]): DocStatus {
    if (!documents.length) return "pending";
    if (documents.some((d) => d.status === "rejected")) return "rejected";
    if (documents.every((d) => d.status === "approved")) return "approved";
    return "pending";
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Chauffeurs — Admin</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (err && !rows.length) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Chauffeurs — Admin</h1>
        <p className="text-red-600 text-sm">{err}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Chauffeurs — vérification admin</h1>

      {err && <p className="text-red-600 text-sm">{err}</p>}
      {ok && <p className="text-green-600 text-sm">{ok}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          Aucun profil chauffeur enregistré pour le moment.
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
                      {r.full_name || "Nom inconnu"}
                    </h2>
                    <p className="text-sm text-gray-600">
                      {r.email || "Email inconnu"}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
                      {r.vehicle_type.toUpperCase()}{" "}
                      {r.vehicle_brand ? `• ${r.vehicle_brand}` : ""}{" "}
                      {r.vehicle_model ? `• ${r.vehicle_model}` : ""}
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
                          <div className="w-32 text-xs font-medium">
                            {d.doc_type === "profile_photo"
                              ? "Photo de profil"
                              : d.doc_type === "driver_license"
                              ? "Permis"
                              : "ID / Passeport"}
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

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={updatingUserId === r.user_id}
                    onClick={() => updateDriverStatus(r.user_id, "approved")}
                    className="px-3 py-1 rounded text-sm bg-green-600 text-white disabled:opacity-60"
                  >
                    {updatingUserId === r.user_id
                      ? "Validation…"
                      : "Approuver"}
                  </button>
                  <button
                    type="button"
                    disabled={updatingUserId === r.user_id}
                    onClick={() => updateDriverStatus(r.user_id, "rejected")}
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
