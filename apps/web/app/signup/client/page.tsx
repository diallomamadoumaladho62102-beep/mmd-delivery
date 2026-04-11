"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "client";

export default function SignupClient() {
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  // email pour envoyer le lien
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // email réel après connexion (lecture seule)
  const [authEmail, setAuthEmail] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Adresse client (domicile / adresse principale)
  const [clientAddress, setClientAddress] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientState, setClientState] = useState("");
  const [clientZip, setClientZip] = useState("");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Récupérer l'utilisateur connecté au chargement
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) {
        console.error(error);
        return;
      }
      const user = data.user;
      setUid(user?.id ?? null);
      setAuthEmail(user?.email ?? "");
    });
  }, []);

  // Envoi du lien magique
  async function sendLink() {
    setErr(null);
    try {
      if (!email) {
        setErr("Merci de saisir un email.");
        return;
      }

      const redirect = `${window.location.origin}/auth/callback?next=/signup/client`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect },
      });

      if (error) {
        setErr(error.message);
      } else {
        setSent(true);
      }
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors de l'envoi du lien.");
    }
  }

  // Sauvegarde du profil client (création une seule fois)
  async function saveProfile() {
    setErr(null);

    if (!uid) {
      setErr("Tu dois être connecté pour enregistrer ton profil.");
      return;
    }

    if (!fullName.trim()) {
      setErr("Merci de saisir ton nom complet.");
      return;
    }

    if (!phone.trim()) {
      setErr("Merci de saisir ton numéro de téléphone.");
      return;
    }

    if (
      !clientAddress.trim() ||
      !clientCity.trim() ||
      !clientState.trim() ||
      !clientZip.trim()
    ) {
      setErr("Merci de saisir ton adresse complète.");
      return;
    }

    // Photo obligatoire
    if (!avatarFile) {
      setErr("Merci de prendre une photo avant d'enregistrer.");
      return;
    }

    setSaving(true);

    try {
      // 1️⃣ Upload de la photo (caméra)
      const ext = avatarFile.name.split(".").pop() || "jpg";
      const path = `clients/${uid}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, {
          upsert: true,
        });

      if (uploadError) {
        console.error(uploadError);
        throw uploadError;
      }

      const avatar_url = uploadData?.path ?? null;

      // 2️⃣ INSERT dans la table profiles (pas upsert)
      const { error: insertErr } = await supabase.from("profiles").insert({
        id: uid, // doit correspondre à auth.users.id
        role: ROLE,
        full_name: fullName || null,
        phone: phone || null,
        avatar_url,
        client_address: clientAddress || null,
        client_city: clientCity || null,
        client_state: clientState || null,
        client_zip: clientZip || null,
      });

      if (insertErr) {
        // Si le profil existe déjà (conflit de clé primaire)
        if ((insertErr as any).code === "23505") {
          setErr(
            "Ton profil client est déjà enregistré. Pour le modifier (adresse ou autre), contacte l'administration (pour l'instant)."
          );
        } else {
          throw insertErr;
        }
        return;
      }

      alert("Profil client enregistré ✅");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors de l'enregistrement du profil.");
    } finally {
      setSaving(false);
    }
  }

  // ⬇️ UI SI PAS CONNECTÉ → ENVOI DU LIEN MAGIQUE
  if (!uid) {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4">
        <h1 className="text-xl font-semibold">Créer un compte — client</h1>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="ton@email.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={sendLink}
            className="px-3 py-2 rounded bg-black text-white text-sm"
            disabled={!email || sent}
          >
            {sent ? "Lien envoyé ✅" : "Envoyer le lien magique"}
          </button>

          <button
            type="button"
            onClick={async () => {
              const { data, error } = await supabase.auth.getUser();
              if (error) {
                console.error(error);
                setErr(error.message);
                return;
              }
              const user = data.user;
              setUid(user?.id ?? null);
              setAuthEmail(user?.email ?? "");
            }}
            className="text-xs underline"
          >
            Je suis déjà connecté — recharger
          </button>
        </div>

        {err && <div className="text-red-600 text-sm">{err}</div>}
      </div>
    );
  }

  // ⬇️ UI SI CONNECTÉ → PROFIL + PHOTO + ADRESSE
  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Ton profil — client</h1>

      {/* Email (non modifiable) */}
      {authEmail && (
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Email (non modifiable)
          </label>
          <input
            className="w-full border rounded px-3 py-2 bg-gray-100"
            value={authEmail}
            disabled
          />
        </div>
      )}

      <div className="space-y-2">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Nom complet"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Téléphone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      {/* Adresse du client */}
      <div className="space-y-2">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Adresse (rue, numéro, appartement)"
          value={clientAddress}
          onChange={(e) => setClientAddress(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Ville"
          value={clientCity}
          onChange={(e) => setClientCity(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="w-1/2 border rounded px-3 py-2"
            placeholder="État (ex: NY)"
            value={clientState}
            onChange={(e) => setClientState(e.target.value)}
          />
          <input
            className="w-1/2 border rounded px-3 py-2"
            placeholder="ZIP code"
            value={clientZip}
            onChange={(e) => setClientZip(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Photo de profil</label>
        <input
          type="file"
          accept="image/*"
          capture="user" // caméra selfie sur mobile
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setAvatarFile(file);
            if (file) {
              const url = URL.createObjectURL(file);
              setAvatarPreview(url);
            } else {
              setAvatarPreview(null);
            }
          }}
        />
        {avatarPreview && (
          <img
            src={avatarPreview}
            alt="Aperçu de la photo"
            className="mt-2 h-24 w-24 rounded-full object-cover border"
          />
        )}
      </div>

      <button
        onClick={saveProfile}
        className="px-3 py-2 rounded bg-black text-white"
        disabled={saving}
      >
        {saving ? "Enregistrement..." : "Enregistrer"}
      </button>

      {err && <div className="text-red-600 text-sm">{err}</div>}
    </div>
  );
}
