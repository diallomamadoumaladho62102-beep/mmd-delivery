"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Profile = {
  id: string;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;

  // Client
  client_address?: string | null;
  client_city?: string | null;
  client_state?: string | null;
  client_zip?: string | null;

  // Restaurant
  restaurant_legal_name?: string | null;
  restaurant_display_name?: string | null;
  restaurant_ein?: string | null;
  restaurant_address?: string | null;
  restaurant_city?: string | null;
  restaurant_state?: string | null;
  restaurant_zip?: string | null;
  restaurant_phone?: string | null;
  restaurant_contact_name?: string | null;
};

type DriverProfile = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
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

function roleLabel(role: string | null): string {
  if (!role) return "Inconnu";
  if (role === "client") return "Client";
  if (role === "driver") return "Chauffeur / Livreur";
  if (role === "restaurant") return "Restaurant";
  if (role === "admin") return "Administrateur";
  return role;
}

function transportModeLabel(value: string | null | undefined): string {
  if (value === "bike") return "Bike";
  if (value === "moto") return "Moto";
  if (value === "car") return "Car";
  return "—";
}

function parseMissingRequirements(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const withoutPrefix = trimmed.replace(/^Missing:\s*/i, "");
  return withoutPrefix
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
  }).format(date);
}

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const missingRequirements = useMemo(
    () => parseMissingRequirements(driverProfile?.missing_requirements),
    [driverProfile?.missing_requirements],
  );

  const mustCompleteDriverProfile =
    profile?.role === "driver" &&
    driverProfile?.status === "approved" &&
    driverProfile?.documents_required === true;

  const canGoOnline =
    profile?.role === "driver" &&
    driverProfile?.status === "approved" &&
    driverProfile?.documents_required === false;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        if (!cancelled) setErr(userErr.message);
        setLoading(false);
        return;
      }

      const user = userData.user;
      if (!user) {
        if (!cancelled) {
          setErr(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setUserEmail(user.email ?? "");
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      if (profErr) {
        if (!cancelled) setErr(profErr.message);
        setLoading(false);
        return;
      }

      if (!prof) {
        if (!cancelled) {
          setProfile(null);
          setDriverProfile(null);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setProfile(prof as Profile);
      }

      if (prof.avatar_url) {
        const { data: signed, error: signedErr } = await supabase.storage
          .from("avatars")
          .createSignedUrl(prof.avatar_url, 60 * 60);

        if (!cancelled && !signedErr && signed?.signedUrl) {
          setAvatarUrl(signed.signedUrl);
        }
      }

      if (prof.role === "driver") {
        const { data: dp, error: dpErr } = await supabase
          .from("driver_profiles")
          .select(
            `
            user_id,
            full_name,
            phone,
            emergency_phone,
            address,
            city,
            state,
            zip_code,
            date_of_birth,
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
          .eq("user_id", user.id)
          .maybeSingle();

        if (dpErr) {
          if (!cancelled) setErr(dpErr.message);
          setLoading(false);
          return;
        }

        if (!cancelled) {
          setDriverProfile((dp as DriverProfile | null) ?? null);
        }
      } else if (!cancelled) {
        setDriverProfile(null);
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setErr(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErr(error.message);
      return;
    }
    router.push("/signup");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-600">Chargement de ton compte…</div>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-semibold text-center">Mon compte</h1>
          <p className="text-sm text-gray-600 text-center">
            Tu n&apos;es pas connecté. Connecte-toi ou crée un compte pour continuer.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm"
          >
            Aller vers la création de compte
          </button>
          {err && <div className="text-red-600 text-xs text-center">{err}</div>}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-semibold text-center">Mon compte</h1>
          <p className="text-sm text-gray-600 text-center">
            Tu es connecté avec <span className="font-mono">{userEmail}</span>, mais aucun
            profil n&apos;a encore été créé.
          </p>
          <p className="text-xs text-gray-500 text-center">
            Va sur la page d&apos;inscription et choisis ton type de compte.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm"
          >
            Choisir mon type de compte
          </button>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded border text-sm mt-2"
          >
            Se déconnecter
          </button>
          {err && <div className="text-red-600 text-xs text-center">{err}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="h-16 w-16 rounded-full object-cover border"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xl">
                {profile.full_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <h1 className="text-xl font-semibold">
                {profile.full_name || "Profil sans nom"}
              </h1>
              <p className="text-xs text-gray-600">{userEmail}</p>
              <p className="text-xs text-gray-500">
                Rôle : <span className="font-medium">{roleLabel(profile.role)}</span>
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-full border text-xs"
          >
            Se déconnecter
          </button>
        </div>

        <div className="border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold">Informations générales</h2>

          <div className="text-sm">
            <span className="text-gray-500">Téléphone : </span>
            <span>{profile.phone || "—"}</span>
          </div>

          {profile.role === "client" && (
            <div className="text-sm space-y-1">
              <div className="text-gray-500 text-xs">Adresse principale :</div>
              <div>
                {profile.client_address && <div>{profile.client_address}</div>}
                {(profile.client_city || profile.client_state || profile.client_zip) && (
                  <div className="text-xs text-gray-600">
                    {[profile.client_city, profile.client_state, profile.client_zip]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {profile.role === "driver" && (
          <div className="space-y-4">
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Profil chauffeur / livreur</h2>

                {driverProfile ? (
                  canGoOnline ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
                      Dossier complet
                    </span>
                  ) : mustCompleteDriverProfile ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-amber-50 text-amber-700 border-amber-200">
                      Profil à compléter
                    </span>
                  ) : driverProfile.status === "approved" ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-gray-50 text-gray-700 border-gray-200">
                      Accès limité
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-blue-50 text-blue-700 border-blue-200">
                      En attente d’approbation
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-semibold bg-red-50 text-red-700 border-red-200">
                    Fiche chauffeur introuvable
                  </span>
                )}
              </div>

              {!driverProfile ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Ton rôle est chauffeur, mais aucune fiche n’a été trouvée dans
                    <code> driver_profiles </code>.
                  </p>
                  <button
                    onClick={() => router.push("/signup/driver")}
                    className="px-3 py-2 rounded bg-black text-white text-sm"
                  >
                    Créer / compléter mon profil chauffeur
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Mode : </span>
                      <span>{transportModeLabel(driverProfile.transport_mode)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Statut : </span>
                      <span>{driverProfile.status || "—"}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Téléphone d’urgence : </span>
                      <span>{driverProfile.emergency_phone || "—"}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Date de naissance : </span>
                      <span>{formatBirthDate(driverProfile.date_of_birth)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Disponibilité : </span>
                      <span>{driverProfile.is_online ? "En ligne" : "Hors ligne"}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Documents requis : </span>
                      <span>{driverProfile.documents_required ? "Oui" : "Non"}</span>
                    </div>
                  </div>

                  <div className="text-sm space-y-1">
                    <div className="text-gray-500 text-xs">Adresse :</div>
                    <div>{driverProfile.address || "—"}</div>
                    <div className="text-xs text-gray-600">
                      {[driverProfile.city, driverProfile.state, driverProfile.zip_code]
                        .filter(Boolean)
                        .join(" " ) || "—"}
                    </div>
                  </div>

                  <div className="text-sm space-y-1">
                    <div className="text-gray-500 text-xs">Véhicule :</div>
                    <div>
                      {[
                        driverProfile.vehicle_brand,
                        driverProfile.vehicle_model,
                        driverProfile.vehicle_year,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </div>
                    <div className="text-xs text-gray-600">
                      {[
                        driverProfile.vehicle_color ? `Couleur: ${driverProfile.vehicle_color}` : null,
                        driverProfile.plate_number ? `Plaque: ${driverProfile.plate_number}` : null,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </div>
                  </div>

                  <div className="text-sm space-y-1">
                    <div className="text-gray-500 text-xs">Permis :</div>
                    <div>
                      {driverProfile.license_number || "—"}
                      {driverProfile.license_expiry
                        ? ` • Expire le ${driverProfile.license_expiry}`
                        : ""}
                    </div>
                  </div>

                  {mustCompleteDriverProfile && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                      <p className="text-sm font-semibold text-amber-800">
                        Ton profil chauffeur est incomplet
                      </p>
                      <p className="text-sm text-amber-700">
                        Merci de compléter les informations et documents manquants pour pouvoir continuer à recevoir des courses.
                      </p>

                      {missingRequirements.length > 0 && (
                        <ul className="space-y-2">
                          {missingRequirements.map((item) => (
                            <li
                              key={item}
                              className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      )}

                      <button
                        onClick={() => router.push("/signup/driver")}
                        className="px-3 py-2 rounded bg-black text-white text-sm"
                      >
                        Compléter mon profil chauffeur
                      </button>
                    </div>
                  )}

                  {!mustCompleteDriverProfile && profile.role === "driver" && (
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => router.push("/signup/driver")}
                        className="px-3 py-2 rounded border text-sm"
                      >
                        Mettre à jour mon profil chauffeur
                      </button>

                      <button
                        onClick={() => router.push("/orders/driver")}
                        className="px-3 py-2 rounded bg-black text-white text-sm"
                      >
                        Ouvrir mon tableau de bord chauffeur
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {profile.role === "restaurant" && (
          <div className="border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Profil restaurant</h2>

            {profile.restaurant_display_name && (
              <div className="text-sm">
                <span className="text-gray-500">Nom affiché : </span>
                {profile.restaurant_display_name}
              </div>
            )}

            {profile.restaurant_legal_name && (
              <div className="text-sm">
                <span className="text-gray-500">Nom légal : </span>
                {profile.restaurant_legal_name}
              </div>
            )}

            {profile.restaurant_ein && (
              <div className="text-sm">
                <span className="text-gray-500">EIN : </span>
                {profile.restaurant_ein}
              </div>
            )}

            {(profile.restaurant_address ||
              profile.restaurant_city ||
              profile.restaurant_state ||
              profile.restaurant_zip) && (
              <div className="text-sm space-y-1">
                <div className="text-gray-500 text-xs">Adresse :</div>
                {profile.restaurant_address && <div>{profile.restaurant_address}</div>}
                {(profile.restaurant_city ||
                  profile.restaurant_state ||
                  profile.restaurant_zip) && (
                  <div className="text-xs text-gray-600">
                    {[profile.restaurant_city, profile.restaurant_state, profile.restaurant_zip]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                )}
              </div>
            )}

            {profile.restaurant_phone && (
              <div className="text-sm">
                <span className="text-gray-500">Téléphone : </span>
                {profile.restaurant_phone}
              </div>
            )}

            {profile.restaurant_contact_name && (
              <div className="text-sm">
                <span className="text-gray-500">Contact principal : </span>
                {profile.restaurant_contact_name}
              </div>
            )}
          </div>
        )}

        {profile.role === "client" && (
          <div className="border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Tes actions</h2>
            <p className="text-xs text-gray-600">
              Depuis cette page, tu peux créer une nouvelle commande de livraison.
            </p>
            <button
              onClick={() => router.push("/orders/new")}
              className="w-full px-3 py-2 rounded bg-black text-white text-sm"
            >
              Créer une nouvelle commande
            </button>
          </div>
        )}

        {err && <div className="text-red-600 text-xs text-center">{err}</div>}

        <p className="text-[11px] text-gray-500 text-center">
          Les informations du profil ne sont pas modifiables directement ici.
          Utilise les pages dédiées pour compléter ou mettre à jour ton dossier.
        </p>
      </div>
    </div>
  );
}