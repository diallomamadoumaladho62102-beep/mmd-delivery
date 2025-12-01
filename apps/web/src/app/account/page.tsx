"use client";

import { useEffect, useState } from "react";
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

  // Driver
  driver_license_number?: string | null;
  driver_license_state?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_plate?: string | null;

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

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Charger user + profil
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      // 1) Récupérer l'utilisateur connecté
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

      // 2) Récupérer le profil
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

      if (!cancelled) {
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }

        setProfile(prof as Profile);

        // 3) Si avatar_url → créer une URL signée (bucket avatars)
        if (prof.avatar_url) {
          const { data: signed, error: signedErr } = await supabase.storage
            .from("avatars")
            .createSignedUrl(prof.avatar_url, 60 * 60); // 1h

          if (!signedErr && signed?.signedUrl) {
            setAvatarUrl(signed.signedUrl);
          }
        }

        setLoading(false);
      }
    }

    load();

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
    // Après déconnexion, retour vers /signup
    router.push("/signup");
  }

  function roleLabel(role: string | null): string {
    if (!role) return "Inconnu";
    if (role === "client") return "Client";
    if (role === "driver") return "Chauffeur / Livreur";
    if (role === "restaurant") return "Restaurant";
    if (role === "admin") return "Administrateur";
    return role;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-600">Chargement de ton compte…</div>
      </div>
    );
  }

  // Pas connecté
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

  // Pas de profil en base
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
            Va sur la page d&apos;inscription et choisis ton type de compte (client, chauffeur ou
            restaurant).
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

  // Vue principale : profil trouvé
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow p-6 space-y-6">
        {/* Header */}
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

        {/* Infos générales */}
        <div className="border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold">Informations générales</h2>
          {profile.phone && (
            <div className="text-sm">
              <span className="text-gray-500">Téléphone : </span>
              <span>{profile.phone}</span>
            </div>
          )}

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

        {/* Bloc spécifique chauffeur */}
        {profile.role === "driver" && (
          <div className="border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold">Profil chauffeur / livreur</h2>
            {profile.driver_license_number && (
              <div className="text-sm">
                <span className="text-gray-500">Permis : </span>
                {profile.driver_license_number} ({profile.driver_license_state})
              </div>
            )}
            {(profile.vehicle_make ||
              profile.vehicle_model ||
              profile.vehicle_year ||
              profile.vehicle_plate) && (
              <div className="text-sm space-y-1">
                <div className="text-gray-500 text-xs">Véhicule :</div>
                <div>
                  {[profile.vehicle_make, profile.vehicle_model, profile.vehicle_year]
                    .filter(Boolean)
                    .join(" ")}
                </div>
                {profile.vehicle_plate && (
                  <div className="text-xs text-gray-600">
                    Plaque : {profile.vehicle_plate}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bloc spécifique restaurant */}
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

        {err && <div className="text-red-600 text-xs text-center">{err}</div>}

        <p className="text-[11px] text-gray-500 text-center">
          Les informations du profil ne sont pas modifiables depuis cette page. Les changements
          se feront par l&apos;administration ou une future page &quot;Modifier mon profil&quot;.
        </p>
      </div>
    </div>
  );
}
