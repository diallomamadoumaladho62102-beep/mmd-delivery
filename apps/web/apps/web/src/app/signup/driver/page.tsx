"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "driver";

type VehicleType = "car" | "moto" | "bike";

export default function SignupDriver() {
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  // type de véhicule
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");

  // email pour envoyer le lien
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // email réel après connexion (lecture seule)
  const [authEmail, setAuthEmail] = useState("");

  // Infos perso
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Infos véhicule
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState<number | "">("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");

  // Permis
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");

  // Photo
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Récupérer l'utilisateur connecté
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

      const redirect = `${window.location.origin}/auth/callback?next=/signup/driver`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect },
      });

      if (error) setErr(error.message);
      else setSent(true);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors de l'envoi du lien.");
    }
  }

  // Sauvegarde du profil driver
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

    // 🚴 VALIDATION VÉLO → seulement marque + modèle obligatoires
    if (vehicleType === "bike") {
      if (!vehicleMake.trim() || !vehicleModel.trim()) {
        setErr(
          "Pour le vélo, merci d’indiquer au moins la marque et le modèle."
        );
        return;
      }
      // permis, année, couleur, plaque → pas obligatoires
    }

    // 🚗🏍️ VALIDATION VOITURE + MOTO → tout obligatoire
    if (vehicleType === "car" || vehicleType === "moto") {
      if (
        !vehicleMake.trim() ||
        !vehicleModel.trim() ||
        !vehicleYear ||
        !vehicleColor.trim() ||
        !vehiclePlate.trim()
      ) {
        setErr(
          "Merci de remplir toutes les informations du véhicule (marque, modèle, année, couleur, plaque)."
        );
        return;
      }

      if (!licenseNumber.trim() || !licenseState.trim()) {
        setErr(
          "Merci de remplir toutes les informations du permis (numéro + état)."
        );
        return;
      }
    }

    if (!avatarFile) {
      setErr("Merci de prendre une photo avant d'enregistrer.");
      return;
    }

    setSaving(true);

    try {
      // Upload de la photo
      const ext = avatarFile.name.split(".").pop() || "jpg";
      const path = `drivers/${uid}/${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true });

      if (uploadError) throw uploadError;

      const avatar_url = uploadData?.path ?? null;

      // INSERT dans profiles
      const { error: insertErr } = await supabase.from("profiles").insert({
        id: uid,
        role: ROLE,
        full_name: fullName || null,
        phone: phone || null,
        avatar_url,

        driver_vehicle_type: vehicleType,
        driver_vehicle_make: vehicleMake || null,
        driver_vehicle_model: vehicleModel || null,
        driver_vehicle_year: vehicleYear === "" ? null : vehicleYear,
        driver_vehicle_color: vehicleColor || null,
        driver_vehicle_plate: vehiclePlate || null,

        driver_license_number: licenseNumber || null,
        driver_license_state: licenseState || null,
      });

      if (insertErr) {
        // si le profil existe déjà
        if ((insertErr as any).code === "23505") {
          setErr("Ton profil chauffeur est déjà enregistré.");
        } else {
          throw insertErr;
        }
        return;
      }

      alert("Profil driver enregistré ✅");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors de l'enregistrement du profil.");
    } finally {
      setSaving(false);
    }
  }

  // UI SI PAS CONNECTÉ
  if (!uid) {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4">
        <h1 className="text-xl font-semibold">Devenir chauffeur / livreur</h1>
        <p className="text-sm text-gray-600">
          Entre ton email pour créer ton compte et continuer l’inscription
          chauffeur.
        </p>

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
            J’ai déjà un compte — recharger
          </button>
        </div>

        {err && <div className="text-red-600 text-sm">{err}</div>}
      </div>
    );
  }

  // UI SI CONNECTÉ
  return (
    <div className="max-w-md mx-auto p-6 space-y-5">
      <h1 className="text-xl font-semibold">Ton profil — chauffeur / livreur</h1>

      {/* Email compte */}
      {authEmail && (
        <div className="space-y-1">
          <label className="block text-sm font-medium">Email (compte)</label>
          <input
            className="w-full border rounded px-3 py-2 bg-gray-100"
            value={authEmail}
            disabled
          />
        </div>
      )}

      {/* Type de véhicule */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Type de véhicule</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
        >
          <option value="car">Voiture</option>
          <option value="moto">Moto / Scooter</option>
          <option value="bike">Vélo</option>
        </select>

        {vehicleType === "bike" ? (
          <p className="text-xs text-gray-600">
            Pour les vélos, le permis et la plaque ne sont pas obligatoires.
          </p>
        ) : (
          <p className="text-xs text-gray-600">
            Pour les voitures et motos, les informations du permis et du véhicule
            sont obligatoires.
          </p>
        )}
      </div>

      {/* Infos perso */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Informations personnelles
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Nom complet"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Téléphone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      {/* Permis */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Permis de conduire{" "}
          {vehicleType === "bike"
            ? "(optionnel pour vélo)"
            : "(obligatoire pour voiture / moto)"}
        </label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Numéro de permis"
          value={licenseNumber}
          onChange={(e) => setLicenseNumber(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="État du permis (ex: NY)"
          value={licenseState}
          onChange={(e) => setLicenseState(e.target.value)}
        />
      </div>

      {/* Véhicule */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Véhicule</label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={
            vehicleType === "bike"
              ? "Marque du vélo (ex: E-Bike, VTT...)"
              : "Marque du véhicule (ex: Honda, Toyota, Yamaha...)"
          }
          value={vehicleMake}
          onChange={(e) => setVehicleMake(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={
            vehicleType === "bike"
              ? "Modèle du vélo (ex: Électrique, VTT...)"
              : "Modèle (ex: Accord, PCX 125...)"
          }
          value={vehicleModel}
          onChange={(e) => setVehicleModel(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Année (ex: 2020)"
          value={vehicleYear}
          onChange={(e) =>
            setVehicleYear(
              e.target.value === "" ? "" : Number(e.target.value)
            )
          }
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={
            vehicleType === "bike" ? "Couleur du vélo" : "Couleur du véhicule"
          }
          value={vehicleColor}
          onChange={(e) => setVehicleColor(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={
            vehicleType === "bike"
              ? "Plaque (optionnel pour vélo)"
              : "Plaque d'immatriculation"
          }
          value={vehiclePlate}
          onChange={(e) => setVehiclePlate(e.target.value)}
        />
      </div>

      {/* Photo */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Photo (chauffeur)</label>
        <input
          type="file"
          accept="image/*"
          capture="user"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setAvatarFile(file);
            if (file) setAvatarPreview(URL.createObjectURL(file));
          }}
        />
        {avatarPreview && (
          <img
            src={avatarPreview}
            className="h-24 w-24 rounded-full object-cover border"
          />
        )}
      </div>

      <button
        onClick={saveProfile}
        className="px-3 py-2 rounded bg-black text-white w-full"
        disabled={saving}
      >
        {saving ? "Enregistrement..." : "Enregistrer mon profil chauffeur"}
      </button>

      {err && <div className="text-red-600 text-sm">{err}</div>}
    </div>
  );
}
