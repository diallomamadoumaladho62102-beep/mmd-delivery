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
  const [dateOfBirth, setDateOfBirth] = useState(""); // ✅ date de naissance

  // Infos véhicule
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState<number | "">("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");

  // Permis (surtout pour voiture / moto)
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");

  // Photo chauffeur (selfie / profil)
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // ✅ Vérification d’identité (ID upload)
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idCountry, setIdCountry] = useState("US");
  const [idExpiry, setIdExpiry] = useState(""); // format YYYY-MM-DD
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

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

  // Sauvegarde du profil driver + vérification d’identité
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

    if (!dateOfBirth.trim()) {
      setErr("Merci de saisir ta date de naissance.");
      return;
    }

    // 🚴 VALIDATION VÉLO → seulement marque + modèle obligatoires
    if (vehicleType === "bike") {
      if (!vehicleMake.trim() || !vehicleModel.trim()) {
        setErr("Pour le vélo, merci d’indiquer au moins la marque et le modèle.");
        return;
      }
      // permis, année, couleur, plaque → pas obligatoires pour vélo
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
      setErr("Merci de prendre une photo de profil avant d'enregistrer.");
      return;
    }

    // ✅ Vérification identité : obligatoire pour tous les chauffeurs (car, moto, vélo)
    if (!idType.trim()) {
      setErr("Merci de choisir le type de pièce d’identité.");
      return;
    }
    if (!idNumber.trim()) {
      setErr("Merci de saisir le numéro de la pièce d’identité.");
      return;
    }
    if (!idCountry.trim()) {
      setErr("Merci de saisir le pays d’émission de la pièce.");
      return;
    }
    if (!idExpiry.trim()) {
      setErr("Merci de saisir la date d’expiration de la pièce.");
      return;
    }
    if (!idFile) {
      setErr("Merci de prendre une photo de ta pièce d’identité.");
      return;
    }

    setSaving(true);

    try {
      // 1️⃣ Upload de la photo chauffeur
      const avatarExt = avatarFile.name.split(".").pop() || "jpg";
      const avatarPath = `drivers/${uid}/avatar_${Date.now()}.${avatarExt}`;

      const { data: avatarUpload, error: avatarError } = await supabase.storage
        .from("avatars")
        .upload(avatarPath, avatarFile, { upsert: true });

      if (avatarError) {
        console.error(avatarError);
        throw avatarError;
      }

      const avatar_url = avatarUpload?.path ?? null;

      // 2️⃣ Upload de la pièce d’identité
      const idExt = idFile.name.split(".").pop() || "jpg";
      const idPath = `drivers/${uid}/id_${Date.now()}.${idExt}`;

      const { data: idUpload, error: idError } = await supabase.storage
        .from("avatars")
        .upload(idPath, idFile, { upsert: true });

      if (idError) {
        console.error(idError);
        throw idError;
      }

      const id_image_path = idUpload?.path ?? null;

      // 3️⃣ UPSERT dans profiles (insert OU update si déjà existant)
      const payload: any = {
        id: uid,
        role: ROLE,
        full_name: fullName || null,
        phone: phone || null,
        avatar_url,

        // Type de véhicule
        driver_vehicle_type: vehicleType,
        driver_vehicle_make: vehicleMake || null,
        driver_vehicle_model: vehicleModel || null,
        driver_vehicle_year: vehicleYear === "" ? null : vehicleYear,
        driver_vehicle_color: vehicleColor || null,
        driver_vehicle_plate: vehiclePlate || null,

        // Permis
        driver_license_number: licenseNumber || null,
        driver_license_state: licenseState || null,
      };

      const { error: upsertProfileErr } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" });

      if (upsertProfileErr) {
        console.error(upsertProfileErr);
        throw upsertProfileErr;
      }

      // 4️⃣ INSERT dans driver_verifications (une seule vérification par chauffeur)
      const { error: verifErr } = await supabase
        .from("driver_verifications")
        .insert({
          user_id: uid,
          date_of_birth: dateOfBirth || null,
          id_type: idType || null,
          id_number: idNumber || null,
          id_country: idCountry || null,
          id_expiry: idExpiry || null,
          id_image_path,
          status: "pending",
        });

      if (verifErr) {
        // 23505 = duplicate key (la vérification existe déjà)
        if ((verifErr as any).code === "23505") {
          setErr(
            "Ta vérification d’identité est déjà enregistrée. Elle est en attente de validation ou déjà validée."
          );
          return;
        }

        console.error(verifErr);
        setErr("Erreur lors de l’enregistrement de la vérification d’identité.");
        return;
      }

      alert(
        "Profil chauffeur + pièce d’identité envoyés ✅\nStatut : en attente de vérification."
      );
    } catch (e: any) {
      console.error(e);
      setErr(
        e?.message ??
          "Erreur lors de l'enregistrement du profil / de la pièce d’identité."
      );
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
        <input
          className="w-full border rounded px-3 py-2"
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
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

      {/* Photo chauffeur */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Photo de profil (chauffeur)
        </label>
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

      {/* Vérification d’identité */}
      <div className="space-y-2 border rounded-lg p-4">
        <label className="block text-sm font-semibold">
          Vérification d’identité
        </label>

        <select
          className="w-full border rounded px-3 py-2"
          value={idType}
          onChange={(e) => setIdType(e.target.value)}
        >
          <option value="">Type de pièce</option>
          <option value="driver_license">Permis de conduire</option>
          <option value="id_card">Carte d’identité</option>
          <option value="passport">Passeport</option>
        </select>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Numéro de la pièce"
          value={idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
        />

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Pays d’émission (ex: US)"
          value={idCountry}
          onChange={(e) => setIdCountry(e.target.value)}
        />

        <input
          className="w-full border rounded px-3 py-2"
          type="date"
          value={idExpiry}
          onChange={(e) => setIdExpiry(e.target.value)}
        />

        <div className="space-y-1">
          <span className="text-sm">Photo de la pièce d’identité</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setIdFile(file);
              if (file) setIdPreview(URL.createObjectURL(file));
            }}
          />
          {idPreview && (
            <img
              src={idPreview}
              className="h-24 w-40 rounded object-cover border mt-2"
            />
          )}
        </div>

        <p className="text-xs text-gray-600">
          Ces informations servent uniquement à vérifier ton identité.
        </p>
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
