"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "driver";
const PROFILE_BUCKET = "avatars";
const DRIVER_DOCS_BUCKET = "driver-docs";

type VehicleType = "car" | "moto" | "bike";
type DriverDocumentStatus = "pending" | "approved" | "rejected";

type DriverDocType =
  | "profile_photo"
  | "id_card_front"
  | "id_card_back"
  | "license_front"
  | "license_back"
  | "insurance"
  | "registration";

type DriverProfileRow = {
  id?: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  emergency_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  transport_mode: VehicleType;
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
  is_online?: boolean | null;
};

type PublicProfileRow = {
  id: string;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  email?: string | null;
};

type DriverDocumentRow = {
  id: string;
  user_id: string;
  doc_type: DriverDocType;
  file_path: string;
  country: string | null;
  state: string | null;
  doc_number: string | null;
  expires_at: string | null;
  status: DriverDocumentStatus | string | null;
  driver_id: string | null;
};

type ExistingDocsMap = Partial<Record<DriverDocType, DriverDocumentRow>>;

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeZip(value: string): string {
  return value.trim();
}

function getFileExt(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext || "jpg";
}

function buildStoragePath(
  uid: string,
  docType: DriverDocType,
  file: File,
): string {
  const ext = getFileExt(file);
  return `drivers/${uid}/${docType}_${Date.now()}.${ext}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return ((error as { message: string }).message || fallback).trim() || fallback;
  }
  return fallback;
}

function normalizeYearInput(value: string): number | "" {
  if (!value.trim()) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function buildLocalDoc(params: {
  existingId?: string;
  uid: string;
  docType: DriverDocType;
  country?: string | null;
  state?: string | null;
  docNumber?: string | null;
  expiresAt?: string | null;
}): DriverDocumentRow {
  return {
    id: params.existingId ?? "local",
    user_id: params.uid,
    doc_type: params.docType,
    file_path: "",
    country: params.country ?? null,
    state: params.state ?? null,
    doc_number: params.docNumber ?? null,
    expires_at: params.expiresAt ?? null,
    status: "pending",
    driver_id: null,
  };
}

export default function SignupDriver() {
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [authEmail, setAuthEmail] = useState("");

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);

  const [vehicleType, setVehicleType] = useState<VehicleType>("bike");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState<number | "">("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");

  const [idType, setIdType] = useState("id_card");
  const [idNumber, setIdNumber] = useState("");
  const [idCountry, setIdCountry] = useState("US");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);

  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [licenseFrontFile, setLicenseFrontFile] = useState<File | null>(null);
  const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [registrationFile, setRegistrationFile] = useState<File | null>(null);

  const [existingDocs, setExistingDocs] = useState<ExistingDocsMap>({});

  const requiresMotorDocs = vehicleType === "car" || vehicleType === "moto";

  const loadConnectedUser = useCallback(async () => {
    setErr(null);

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      setErr(error.message);
      return;
    }

    const user = data.user;
    setUid(user?.id ?? null);
    setAuthEmail(user?.email ?? "");
  }, []);

  useEffect(() => {
    void loadConnectedUser();
  }, [loadConnectedUser]);

  useEffect(() => {
    if (!uid) {
      setExistingDocs({});
      setLoadingProfile(false);
      return;
    }

    let cancelled = false;

    async function loadExistingData() {
      setLoadingProfile(true);
      setErr(null);

      try {
        const [
          { data: publicProfile, error: publicProfileErr },
          { data: driverProfile, error: driverProfileErr },
          { data: docs, error: docsErr },
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, role, full_name, phone, avatar_url, email")
            .eq("id", uid)
            .maybeSingle<PublicProfileRow>(),
          supabase
            .from("driver_profiles")
            .select("*")
            .eq("user_id", uid)
            .maybeSingle<DriverProfileRow>(),
          supabase.from("driver_documents").select("*").eq("user_id", uid),
        ]);

        if (publicProfileErr) throw publicProfileErr;
        if (driverProfileErr) throw driverProfileErr;
        if (docsErr) throw docsErr;

        if (cancelled) return;

        if (publicProfile) {
          setFullName(publicProfile.full_name ?? "");
          setPhone(publicProfile.phone ?? "");
        }

        if (driverProfile) {
          setFullName(driverProfile.full_name ?? publicProfile?.full_name ?? "");
          setPhone(driverProfile.phone ?? publicProfile?.phone ?? "");
          setEmergencyPhone(driverProfile.emergency_phone ?? "");
          setAddress(driverProfile.address ?? "");
          setCity(driverProfile.city ?? "");
          setStateValue(driverProfile.state ?? "");
          setZipCode(driverProfile.zip_code ?? "");
          setDateOfBirth(driverProfile.date_of_birth ?? "");
          setVehicleType((driverProfile.transport_mode as VehicleType) || "bike");
          setVehicleBrand(driverProfile.vehicle_brand ?? "");
          setVehicleModel(driverProfile.vehicle_model ?? "");
          setVehicleYear(driverProfile.vehicle_year ?? "");
          setVehicleColor(driverProfile.vehicle_color ?? "");
          setPlateNumber(driverProfile.plate_number ?? "");
          setLicenseNumber(driverProfile.license_number ?? "");
          setLicenseExpiry(driverProfile.license_expiry ?? "");
        }

        const mapped: ExistingDocsMap = {};
        for (const doc of (docs ?? []) as DriverDocumentRow[]) {
          mapped[doc.doc_type] = doc;
        }
        setExistingDocs(mapped);

        const idDoc = mapped.id_card_front || mapped.id_card_back;
        if (idDoc?.doc_number) setIdNumber(idDoc.doc_number);
        if (idDoc?.country) setIdCountry(idDoc.country);
      } catch (error: unknown) {
        if (!cancelled) {
          setErr(
            toErrorMessage(
              error,
              "Erreur lors du chargement du profil chauffeur.",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    }

    void loadExistingData();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function sendLink() {
    setErr(null);
    setSuccess(null);

    try {
      if (!email.trim()) {
        setErr("Merci de saisir un email.");
        return;
      }

      const redirect = `${window.location.origin}/auth/callback?next=/signup/driver`;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      });

      if (error) {
        setErr(error.message);
        return;
      }

      setSent(true);
      setSuccess("Lien magique envoyé. Ouvre ton email puis reviens sur cette page.");
    } catch (error: unknown) {
      setErr(toErrorMessage(error, "Erreur lors de l'envoi du lien."));
    }
  }

  const hasProfilePhoto = !!profilePhotoFile || !!existingDocs.profile_photo;
  const hasIdFront = !!idFrontFile || !!existingDocs.id_card_front;
  const hasIdBack = !!idBackFile || !!existingDocs.id_card_back;
  const hasLicenseFront = !!licenseFrontFile || !!existingDocs.license_front;
  const hasLicenseBack = !!licenseBackFile || !!existingDocs.license_back;
  const hasInsurance = !!insuranceFile || !!existingDocs.insurance;
  const hasRegistration = !!registrationFile || !!existingDocs.registration;

  const isBaseComplete = useMemo(() => {
    return (
      !!trimOrNull(fullName) &&
      !!trimOrNull(phone) &&
      !!trimOrNull(emergencyPhone) &&
      !!trimOrNull(address) &&
      !!trimOrNull(city) &&
      !!trimOrNull(stateValue) &&
      !!trimOrNull(normalizeZip(zipCode)) &&
      !!trimOrNull(dateOfBirth) &&
      hasProfilePhoto &&
      !!trimOrNull(idType) &&
      !!trimOrNull(idNumber) &&
      !!trimOrNull(idCountry) &&
      hasIdFront &&
      hasIdBack
    );
  }, [
    fullName,
    phone,
    emergencyPhone,
    address,
    city,
    stateValue,
    zipCode,
    dateOfBirth,
    hasProfilePhoto,
    idType,
    idNumber,
    idCountry,
    hasIdFront,
    hasIdBack,
  ]);

  const isMotorComplete = useMemo(() => {
    if (!requiresMotorDocs) return true;

    return (
      !!trimOrNull(licenseNumber) &&
      !!trimOrNull(licenseExpiry) &&
      !!trimOrNull(vehicleBrand) &&
      !!trimOrNull(vehicleModel) &&
      !!vehicleYear &&
      !!trimOrNull(vehicleColor) &&
      !!trimOrNull(plateNumber) &&
      hasLicenseFront &&
      hasLicenseBack &&
      hasInsurance &&
      hasRegistration
    );
  }, [
    requiresMotorDocs,
    licenseNumber,
    licenseExpiry,
    vehicleBrand,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    plateNumber,
    hasLicenseFront,
    hasLicenseBack,
    hasInsurance,
    hasRegistration,
  ]);

  const isProfileComplete = isBaseComplete && isMotorComplete;

  async function uploadAndUpsertDocument(
    docType: DriverDocType,
    file: File,
    extra?: {
      country?: string | null;
      state?: string | null;
      doc_number?: string | null;
      expires_at?: string | null;
    },
  ) {
    if (!uid) {
      throw new Error("Utilisateur non connecté.");
    }

    const filePath = buildStoragePath(uid, docType, file);

    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(DRIVER_DOCS_BUCKET)
      .upload(filePath, file, { upsert: true });

    if (uploadErr) throw uploadErr;

    const payload = {
      user_id: uid,
      driver_id: null,
      doc_type: docType,
      file_path: uploadData.path,
      country: extra?.country ?? null,
      state: extra?.state ?? null,
      doc_number: extra?.doc_number ?? null,
      expires_at: extra?.expires_at ?? null,
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      review_notes: null,
    };

    const { error: docErr } = await supabase
      .from("driver_documents")
      .upsert(payload, { onConflict: "user_id,doc_type" });

    if (docErr) throw docErr;
  }

  async function upsertPublicProfile(
    params: {
      avatarUrl?: string | null;
    } = {},
  ) {
    if (!uid) throw new Error("Utilisateur non connecté.");

    const payload = {
      id: uid,
      role: ROLE,
      full_name: trimOrNull(fullName),
      phone: trimOrNull(phone),
      email: authEmail || null,
      ...(params.avatarUrl ? { avatar_url: params.avatarUrl } : {}),
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) throw error;
  }

  async function saveProfile() {
    setErr(null);
    setSuccess(null);

    if (!uid) {
      setErr("Tu dois être connecté pour enregistrer ton profil.");
      return;
    }

    if (!trimOrNull(fullName)) {
      setErr("Merci de saisir ton nom complet.");
      return;
    }

    if (!trimOrNull(phone)) {
      setErr("Merci de saisir ton numéro de téléphone.");
      return;
    }

    if (!trimOrNull(emergencyPhone)) {
      setErr("Merci de saisir un numéro de téléphone d’urgence.");
      return;
    }

    if (!trimOrNull(address)) {
      setErr("Merci de saisir ton adresse.");
      return;
    }

    if (!trimOrNull(city)) {
      setErr("Merci de saisir ta ville.");
      return;
    }

    if (!trimOrNull(stateValue)) {
      setErr("Merci de saisir ton État.");
      return;
    }

    if (!trimOrNull(normalizeZip(zipCode))) {
      setErr("Merci de saisir ton ZIP code.");
      return;
    }

    if (!trimOrNull(dateOfBirth)) {
      setErr("Merci de saisir ta date de naissance.");
      return;
    }

    if (!trimOrNull(idType)) {
      setErr("Merci de choisir le type de pièce d’identité.");
      return;
    }

    if (!trimOrNull(idNumber)) {
      setErr("Merci de saisir le numéro de la pièce d’identité.");
      return;
    }

    if (!trimOrNull(idCountry)) {
      setErr("Merci de saisir le pays d’émission de la pièce.");
      return;
    }

    if (!hasProfilePhoto) {
      setErr("Merci d’ajouter une photo personnelle.");
      return;
    }

    if (!hasIdFront) {
      setErr("Merci d’ajouter la photo recto de la pièce d’identité.");
      return;
    }

    if (!hasIdBack) {
      setErr("Merci d’ajouter la photo verso de la pièce d’identité.");
      return;
    }

    if (requiresMotorDocs) {
      if (!trimOrNull(licenseNumber)) {
        setErr("Merci de saisir le numéro du permis.");
        return;
      }

      if (!trimOrNull(licenseExpiry)) {
        setErr("Merci de saisir la date d’expiration du permis.");
        return;
      }

      if (!trimOrNull(vehicleBrand)) {
        setErr("Merci de saisir la marque du véhicule.");
        return;
      }

      if (!trimOrNull(vehicleModel)) {
        setErr("Merci de saisir le modèle du véhicule.");
        return;
      }

      if (!vehicleYear) {
        setErr("Merci de saisir l’année du véhicule.");
        return;
      }

      if (!trimOrNull(vehicleColor)) {
        setErr("Merci de saisir la couleur du véhicule.");
        return;
      }

      if (!trimOrNull(plateNumber)) {
        setErr("Merci de saisir la plaque d’immatriculation.");
        return;
      }

      if (!hasLicenseFront) {
        setErr("Merci d’ajouter la photo recto du permis.");
        return;
      }

      if (!hasLicenseBack) {
        setErr("Merci d’ajouter la photo verso du permis.");
        return;
      }

      if (!hasInsurance) {
        setErr("Merci d’ajouter le document d’assurance.");
        return;
      }

      if (!hasRegistration) {
        setErr("Merci d’ajouter le document de registration.");
        return;
      }
    }

    setSaving(true);

    try {
      if (profilePhotoFile) {
        const avatarPath = buildStoragePath(uid, "profile_photo", profilePhotoFile);

        const { data: avatarUpload, error: avatarError } = await supabase.storage
          .from(PROFILE_BUCKET)
          .upload(avatarPath, profilePhotoFile, { upsert: true });

        if (avatarError) throw avatarError;

        await upsertPublicProfile({ avatarUrl: avatarUpload.path });
        await uploadAndUpsertDocument("profile_photo", profilePhotoFile);
      } else {
        await upsertPublicProfile();
      }

      const driverProfilePayload = {
        user_id: uid,
        full_name: trimOrNull(fullName),
        phone: trimOrNull(phone),
        emergency_phone: trimOrNull(emergencyPhone),
        address: trimOrNull(address),
        city: trimOrNull(city),
        state: trimOrNull(stateValue),
        zip_code: trimOrNull(normalizeZip(zipCode)),
        date_of_birth: trimOrNull(dateOfBirth),
        transport_mode: vehicleType,
        vehicle_type: vehicleType,
        vehicle_brand: trimOrNull(vehicleBrand),
        vehicle_model: trimOrNull(vehicleModel),
        vehicle_year: vehicleYear === "" ? null : Number(vehicleYear),
        vehicle_color: trimOrNull(vehicleColor),
        plate_number: trimOrNull(plateNumber),
        license_number: trimOrNull(licenseNumber),
        license_expiry: trimOrNull(licenseExpiry),
        documents_required: !isProfileComplete,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertDriverProfileErr } = await supabase
        .from("driver_profiles")
        .upsert(driverProfilePayload, { onConflict: "user_id" });

      if (upsertDriverProfileErr) throw upsertDriverProfileErr;

      const uploads: Promise<void>[] = [];

      if (idFrontFile) {
        uploads.push(
          uploadAndUpsertDocument("id_card_front", idFrontFile, {
            country: trimOrNull(idCountry),
            doc_number: trimOrNull(idNumber),
          }),
        );
      }

      if (idBackFile) {
        uploads.push(
          uploadAndUpsertDocument("id_card_back", idBackFile, {
            country: trimOrNull(idCountry),
            doc_number: trimOrNull(idNumber),
          }),
        );
      }

      if (requiresMotorDocs && licenseFrontFile) {
        uploads.push(
          uploadAndUpsertDocument("license_front", licenseFrontFile, {
            country: "US",
            state: trimOrNull(stateValue),
            doc_number: trimOrNull(licenseNumber),
            expires_at: trimOrNull(licenseExpiry),
          }),
        );
      }

      if (requiresMotorDocs && licenseBackFile) {
        uploads.push(
          uploadAndUpsertDocument("license_back", licenseBackFile, {
            country: "US",
            state: trimOrNull(stateValue),
            doc_number: trimOrNull(licenseNumber),
            expires_at: trimOrNull(licenseExpiry),
          }),
        );
      }

      if (requiresMotorDocs && insuranceFile) {
        uploads.push(uploadAndUpsertDocument("insurance", insuranceFile));
      }

      if (requiresMotorDocs && registrationFile) {
        uploads.push(uploadAndUpsertDocument("registration", registrationFile));
      }

      await Promise.all(uploads);

      const refreshedDocs: ExistingDocsMap = {
        ...existingDocs,
        ...(profilePhotoFile
          ? {
              profile_photo: buildLocalDoc({
                existingId: existingDocs.profile_photo?.id,
                uid,
                docType: "profile_photo",
              }),
            }
          : {}),
        ...(idFrontFile
          ? {
              id_card_front: buildLocalDoc({
                existingId: existingDocs.id_card_front?.id,
                uid,
                docType: "id_card_front",
                country: trimOrNull(idCountry),
                docNumber: trimOrNull(idNumber),
              }),
            }
          : {}),
        ...(idBackFile
          ? {
              id_card_back: buildLocalDoc({
                existingId: existingDocs.id_card_back?.id,
                uid,
                docType: "id_card_back",
                country: trimOrNull(idCountry),
                docNumber: trimOrNull(idNumber),
              }),
            }
          : {}),
        ...(licenseFrontFile
          ? {
              license_front: buildLocalDoc({
                existingId: existingDocs.license_front?.id,
                uid,
                docType: "license_front",
                country: "US",
                state: trimOrNull(stateValue),
                docNumber: trimOrNull(licenseNumber),
                expiresAt: trimOrNull(licenseExpiry),
              }),
            }
          : {}),
        ...(licenseBackFile
          ? {
              license_back: buildLocalDoc({
                existingId: existingDocs.license_back?.id,
                uid,
                docType: "license_back",
                country: "US",
                state: trimOrNull(stateValue),
                docNumber: trimOrNull(licenseNumber),
                expiresAt: trimOrNull(licenseExpiry),
              }),
            }
          : {}),
        ...(insuranceFile
          ? {
              insurance: buildLocalDoc({
                existingId: existingDocs.insurance?.id,
                uid,
                docType: "insurance",
              }),
            }
          : {}),
        ...(registrationFile
          ? {
              registration: buildLocalDoc({
                existingId: existingDocs.registration?.id,
                uid,
                docType: "registration",
              }),
            }
          : {}),
      };

      setExistingDocs(refreshedDocs);

      setProfilePhotoFile(null);
      setIdFrontFile(null);
      setIdBackFile(null);
      setLicenseFrontFile(null);
      setLicenseBackFile(null);
      setInsuranceFile(null);
      setRegistrationFile(null);

      setSuccess(
        isProfileComplete
          ? "Profil chauffeur enregistré. Ton dossier est complet."
          : "Profil chauffeur enregistré. Il manque encore des informations ou documents.",
      );
    } catch (error: unknown) {
      setErr(
        toErrorMessage(
          error,
          "Erreur lors de l'enregistrement du profil chauffeur.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  function renderFileStatus(
    label: string,
    hasExisting: boolean,
    pendingNew: boolean,
  ) {
    if (pendingNew) {
      return <span className="text-xs text-green-700">Nouveau fichier prêt : {label}</span>;
    }
    if (hasExisting) {
      return <span className="text-xs text-blue-700">Déjà enregistré : {label}</span>;
    }
    return <span className="text-xs text-gray-500">Manquant : {label}</span>;
  }

  if (!uid) {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4">
        <h1 className="text-xl font-semibold">Devenir chauffeur / livreur</h1>
        <p className="text-sm text-gray-600">
          Entre ton email pour créer ton compte et continuer l’inscription chauffeur.
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
            disabled={!email.trim() || sent}
          >
            {sent ? "Lien envoyé ✅" : "Envoyer le lien magique"}
          </button>

          <button
            type="button"
            onClick={() => void loadConnectedUser()}
            className="text-xs underline"
          >
            J’ai déjà un compte — recharger
          </button>
        </div>

        {success && <div className="text-green-700 text-sm">{success}</div>}
        {err && <div className="text-red-600 text-sm">{err}</div>}
      </div>
    );
  }

  if (loadingProfile) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="text-sm text-gray-600">Chargement du profil chauffeur…</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ton profil — chauffeur / livreur</h1>
        <p className="text-sm text-gray-600 mt-1">
          Complète toutes les informations demandées. Pour vélo, seuls les documents
          d’identité sont exigés. Pour moto et voiture, le permis, l’assurance et la
          registration sont aussi obligatoires.
        </p>
      </div>

      {authEmail && (
        <div className="space-y-1">
          <label className="block text-sm font-medium">Email du compte</label>
          <input
            className="w-full border rounded px-3 py-2 bg-gray-100"
            value={authEmail}
            disabled
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-medium">Mode de transport</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
        >
          <option value="bike">Vélo</option>
          <option value="moto">Moto / Scooter</option>
          <option value="car">Voiture</option>
        </select>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Informations personnelles</h2>

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
          placeholder="Téléphone d’urgence"
          value={emergencyPhone}
          onChange={(e) => setEmergencyPhone(e.target.value)}
        />

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Adresse"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Ville"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="État"
            value={stateValue}
            onChange={(e) => setStateValue(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="ZIP code"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
          />
        </div>

        <input
          className="w-full border rounded px-3 py-2"
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
        />
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Photo personnelle</h2>

        <input
          type="file"
          accept="image/*"
          capture="user"
          onChange={(e) => setProfilePhotoFile(e.target.files?.[0] ?? null)}
        />

        {renderFileStatus(
          "photo personnelle",
          !!existingDocs.profile_photo,
          !!profilePhotoFile,
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Pièce d’identité</h2>

        <select
          className="w-full border rounded px-3 py-2"
          value={idType}
          onChange={(e) => setIdType(e.target.value)}
        >
          <option value="id_card">Carte d’identité</option>
          <option value="passport">Passeport</option>
          <option value="driver_license">Permis de conduire</option>
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

        <div className="space-y-2">
          <label className="block text-sm font-medium">Photo recto</label>
          <input
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            onChange={(e) => setIdFrontFile(e.target.files?.[0] ?? null)}
          />
          {renderFileStatus(
            "ID recto",
            !!existingDocs.id_card_front,
            !!idFrontFile,
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Photo verso</label>
          <input
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            onChange={(e) => setIdBackFile(e.target.files?.[0] ?? null)}
          />
          {renderFileStatus(
            "ID verso",
            !!existingDocs.id_card_back,
            !!idBackFile,
          )}
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">
          Véhicule {vehicleType === "bike" ? "(optionnel pour vélo)" : "(obligatoire)"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Marque"
            value={vehicleBrand}
            onChange={(e) => setVehicleBrand(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Modèle"
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Année"
            type="number"
            value={vehicleYear}
            onChange={(e) => setVehicleYear(normalizeYearInput(e.target.value))}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Couleur"
            value={vehicleColor}
            onChange={(e) => setVehicleColor(e.target.value)}
          />
        </div>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Plaque d’immatriculation"
          value={plateNumber}
          onChange={(e) => setPlateNumber(e.target.value)}
        />
      </div>

      {requiresMotorDocs && (
        <>
          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold">Permis de conduire</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="w-full border rounded px-3 py-2"
                placeholder="Numéro du permis"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
              />
              <input
                className="w-full border rounded px-3 py-2"
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Photo recto du permis</label>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(e) => setLicenseFrontFile(e.target.files?.[0] ?? null)}
              />
              {renderFileStatus(
                "permis recto",
                !!existingDocs.license_front,
                !!licenseFrontFile,
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Photo verso du permis</label>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(e) => setLicenseBackFile(e.target.files?.[0] ?? null)}
              />
              {renderFileStatus(
                "permis verso",
                !!existingDocs.license_back,
                !!licenseBackFile,
              )}
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold">Documents véhicule</h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Assurance</label>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(e) => setInsuranceFile(e.target.files?.[0] ?? null)}
              />
              {renderFileStatus(
                "assurance",
                !!existingDocs.insurance,
                !!insuranceFile,
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Registration</label>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={(e) => setRegistrationFile(e.target.files?.[0] ?? null)}
              />
              {renderFileStatus(
                "registration",
                !!existingDocs.registration,
                !!registrationFile,
              )}
            </div>
          </div>
        </>
      )}

      <div className="border rounded-lg p-4 space-y-2 bg-gray-50">
        <h2 className="text-sm font-semibold">État du dossier</h2>
        <div className="text-sm">
          Base profile:{" "}
          <span className={isBaseComplete ? "text-green-700" : "text-red-600"}>
            {isBaseComplete ? "complet" : "incomplet"}
          </span>
        </div>
        <div className="text-sm">
          Vehicle requirements:{" "}
          <span className={isMotorComplete ? "text-green-700" : "text-red-600"}>
            {isMotorComplete ? "complet" : "incomplet"}
          </span>
        </div>
        <div className="text-sm font-medium">
          Overall:{" "}
          <span className={isProfileComplete ? "text-green-700" : "text-red-600"}>
            {isProfileComplete ? "profil complet" : "profil incomplet"}
          </span>
        </div>
      </div>

      <button
        onClick={() => void saveProfile()}
        className="px-4 py-3 rounded bg-black text-white w-full disabled:opacity-60"
        disabled={saving}
      >
        {saving ? "Enregistrement..." : "Enregistrer mon profil chauffeur"}
      </button>

      {success && <div className="text-green-700 text-sm">{success}</div>}
      {err && <div className="text-red-600 text-sm">{err}</div>}
    </div>
  );
}