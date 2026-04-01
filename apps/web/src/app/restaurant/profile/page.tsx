"use client";

import { useEffect, useState, ChangeEvent, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type RestaurantProfileRow = {
  user_id: string;
  restaurant_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  cuisine_type: string | null;
  description: string | null;
  license_number: string | null;
  tax_id: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  offers_dine_in: boolean;
};

type RestaurantDocType = "logo" | "business_license" | "other";

type RestaurantDocumentRow = {
  id?: string;
  user_id: string;
  doc_type: RestaurantDocType;
  file_path: string;
  status?: "pending" | "approved" | "rejected";
};

type AccountInfo = {
  full_name: string | null;
  email: string | null;
};

type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type OpeningHours = Record<DayKey, { open: string; close: string }>;

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

function getDefaultOpeningHours(): OpeningHours {
  return {
    monday: { open: "", close: "" },
    tuesday: { open: "", close: "" },
    wednesday: { open: "", close: "" },
    thursday: { open: "", close: "" },
    friday: { open: "", close: "" },
    saturday: { open: "", close: "" },
    sunday: { open: "", close: "" },
  };
}

export default function RestaurantProfilePage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [profile, setProfile] = useState<RestaurantProfileRow | null>(null);
  const [docs, setDocs] = useState<
    Record<RestaurantDocType, RestaurantDocumentRow | null>
  >({
    logo: null,
    business_license: null,
    other: null,
  });

  // fichiers sélectionnés localement
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [otherFile, setOtherFile] = useState<File | null>(null);

  const [openingHours, setOpeningHours] = useState<OpeningHours>(() =>
    getDefaultOpeningHours()
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<RestaurantDocType | null>(
    null
  );
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // 🔹 Charger user + profil restaurant + docs
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      setOk(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error(userError);
        if (!cancelled) {
          setErr(userError.message);
          setLoading(false);
        }
        return;
      }

      if (!user) {
        if (!cancelled) {
          setErr("Tu dois te connecter pour accéder au profil restaurant.");
          router.push("/auth/login");
        }
        setLoading(false);
        return;
      }

      const uid = user.id;
      if (cancelled) return;
      setUserId(uid);

      // Compte (nom + email)
      let initialAccount: AccountInfo = {
        full_name: null,
        email: user.email ?? null,
      };

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", uid)
        .maybeSingle();

      if (profileError) {
        console.error(profileError);
      } else if (profileRow) {
        initialAccount.full_name = profileRow.full_name ?? null;
      }

      if (!cancelled) {
        setAccount(initialAccount);
      }

      // Profil restaurant
      const { data: rpRow, error: rpError } = await supabase
        .from("restaurant_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (rpError && rpError.code !== "PGRST116") {
        console.error(rpError);
        if (!cancelled) setErr(rpError.message);
      }

      const openingFromDb = (rpRow as any)?.opening_hours || null;
      const defaultOH = getDefaultOpeningHours();

      if (openingFromDb && typeof openingFromDb === "object") {
        (Object.keys(defaultOH) as DayKey[]).forEach((day) => {
          if (
            openingFromDb[day] &&
            typeof openingFromDb[day].open === "string" &&
            typeof openingFromDb[day].close === "string"
          ) {
            defaultOH[day] = {
              open: openingFromDb[day].open,
              close: openingFromDb[day].close,
            };
          }
        });
      }

      const rp: RestaurantProfileRow = {
        user_id: uid,
        restaurant_name: rpRow?.restaurant_name ?? "",
        phone: rpRow?.phone ?? "",
        email: rpRow?.email ?? user.email ?? "",
        address: rpRow?.address ?? "",
        city: rpRow?.city ?? "",
        postal_code: rpRow?.postal_code ?? "",
        cuisine_type: rpRow?.cuisine_type ?? "",
        description: rpRow?.description ?? "",
        license_number: rpRow?.license_number ?? "",
        tax_id: rpRow?.tax_id ?? "",
        website: rpRow?.website ?? "",
        instagram: rpRow?.instagram ?? "",
        facebook: rpRow?.facebook ?? "",
        offers_delivery:
          rpRow?.offers_delivery === undefined ? true : !!rpRow.offers_delivery,
        offers_pickup:
          rpRow?.offers_pickup === undefined ? true : !!rpRow.offers_pickup,
        offers_dine_in:
          rpRow?.offers_dine_in === undefined ? false : !!rpRow.offers_dine_in,
      };

      // Documents restaurant existants
      const { data: docsData, error: docsError } = await supabase
        .from("restaurant_documents")
        .select("*")
        .eq("user_id", uid);

      if (docsError) {
        console.error(docsError);
        if (!cancelled) setErr(docsError.message);
      }

      const docState: Record<
        RestaurantDocType,
        RestaurantDocumentRow | null
      > = {
        logo: null,
        business_license: null,
        other: null,
      };

      docsData?.forEach((row: any) => {
        if (row.doc_type === "logo") docState.logo = row;
        if (row.doc_type === "business_license")
          docState.business_license = row;
        if (row.doc_type === "other") docState.other = row;
      });

      if (!cancelled) {
        setProfile(rp);
        setDocs(docState);
        setOpeningHours(defaultOH);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // 🔹 Gestion des champs texte du profil
  function onChangeField(
    field:
      | "restaurant_name"
      | "phone"
      | "email"
      | "address"
      | "city"
      | "postal_code"
      | "cuisine_type"
      | "description"
      | "license_number"
      | "tax_id"
      | "website"
      | "instagram"
      | "facebook",
    value: string
  ) {
    if (!profile) return;
    const updated: RestaurantProfileRow = { ...profile };
    (updated as any)[field] = value || "";
    setProfile(updated);
  }

  // 🔹 Gestion des booléens (options de livraison)
  function onChangeOption(
    field: "offers_delivery" | "offers_pickup" | "offers_dine_in",
    value: boolean
  ) {
    if (!profile) return;
    const updated: RestaurantProfileRow = { ...profile };
    (updated as any)[field] = value;
    setProfile(updated);
  }

  // 🔹 Gestion des horaires
  function onChangeOpeningHours(
    day: DayKey,
    part: "open" | "close",
    value: string
  ) {
    setOpeningHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [part]: value },
    }));
  }

  // 🔹 Helper upload d’un seul document (utilisé dans onSubmit)
  async function uploadOneDoc(
    docType: RestaurantDocType,
    file: File
  ): Promise<RestaurantDocumentRow | null> {
    if (!userId) return null;
    setUploadingDoc(docType);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${docType}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("restaurant-docs")
        .upload(path, file);

      if (uploadError) {
        console.error(uploadError);
        setErr(uploadError.message);
        return null;
      }

      const { data, error: docError } = await supabase
        .from("restaurant_documents")
        .upsert(
          {
            user_id: userId,
            doc_type: docType,
            file_path: path,
            status: "pending",
          },
          {
            onConflict: "user_id,doc_type",
          }
        )
        .select("*")
        .single();

      if (docError) {
        console.error(docError);
        setErr(docError.message);
        return null;
      }

      return data as RestaurantDocumentRow;
    } finally {
      setUploadingDoc(null);
    }
  }

  // 🔹 Sauvegarder le profil restaurant + fichiers
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !profile) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    // 1) Mettre à jour le nom complet dans profiles (optionnel)
    if (account) {
      const { error: accError } = await supabase
        .from("profiles")
        .update({
          full_name: account.full_name,
        })
        .eq("id", userId);

      if (accError) {
        console.error(accError);
        setErr(accError.message);
        setSaving(false);
        return;
      }
    }

    // 2) Upsert du profil restaurant
    const payload = {
      user_id: userId,
      restaurant_name: profile.restaurant_name || "",
      phone: profile.phone || null,
      email: profile.email || null,
      address: profile.address || null,
      city: profile.city || null,
      postal_code: profile.postal_code || null,
      cuisine_type: profile.cuisine_type || null,
      description: profile.description || null,
      license_number: profile.license_number || null,
      tax_id: profile.tax_id || null,
      website: profile.website || null,
      instagram: profile.instagram || null,
      facebook: profile.facebook || null,
      offers_delivery: profile.offers_delivery,
      offers_pickup: profile.offers_pickup,
      offers_dine_in: profile.offers_dine_in,
      opening_hours: openingHours,
    };

    const { error } = await supabase
      .from("restaurant_profiles")
      .upsert(payload, {
        onConflict: "user_id",
      });

    if (error) {
      console.error(error);
      setErr(error.message);
      setSaving(false);
      return;
    }

    // 3) Upload des fichiers sélectionnés
    let hadUploadError = false;
    const newDocs: Record<RestaurantDocType, RestaurantDocumentRow | null> = {
      ...docs,
    };

    if (logoFile) {
      const row = await uploadOneDoc("logo", logoFile);
      if (!row) {
        hadUploadError = true;
      } else {
        newDocs.logo = row;
      }
    }

    if (licenseFile) {
      const row = await uploadOneDoc("business_license", licenseFile);
      if (!row) {
        hadUploadError = true;
      } else {
        newDocs.business_license = row;
      }
    }

    if (otherFile) {
      const row = await uploadOneDoc("other", otherFile);
      if (!row) {
        hadUploadError = true;
      } else {
        newDocs.other = row;
      }
    }

    setDocs(newDocs);
    setLogoFile(null);
    setLicenseFile(null);
    setOtherFile(null);

    if (!hadUploadError) {
      setOk("Profil restaurant enregistré avec succès ✅");
    } else {
      setOk(
        "Profil enregistré, mais une erreur est survenue lors de l’envoi de certains documents."
      );
    }

    setSaving(false);
  }

  if (loading || !profile) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Profil restaurant</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold mb-2">Profil restaurant</h1>
        <p>Tu dois être connecté pour voir cette page.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Profil restaurant</h1>

      {err && <p className="text-red-600 text-sm">{err}</p>}
      {ok && <p className="text-green-600 text-sm">{ok}</p>}

      <form onSubmit={onSubmit} className="space-y-4 border rounded-lg p-4 bg-white">
        {/* COMPTE & CONTACT */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Compte & contact</h2>

          <label className="block text-sm font-medium">
            Nom complet (propriétaire / contact)
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={account?.full_name ?? ""}
              onChange={(e) =>
                setAccount((prev) =>
                  prev
                    ? { ...prev, full_name: e.target.value }
                    : { full_name: e.target.value, email: profile.email }
                )
              }
              placeholder="Mamadou Maladho Diallo"
            />
          </label>

          <label className="block text-sm font-medium">
            Email de contact
            <input
              type="email"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.email ?? ""}
              onChange={(e) => onChangeField("email", e.target.value)}
              placeholder="contact@monrestaurant.com"
            />
          </label>

          <label className="block text-sm font-medium">
            Téléphone du restaurant
            <input
              type="tel"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.phone ?? ""}
              onChange={(e) => onChangeField("phone", e.target.value)}
              placeholder="929 000 0000"
            />
          </label>
        </div>

        {/* DÉTAILS DU RESTAURANT */}
        <div className="space-y-3 pt-2 border-t pt-4">
          <h2 className="text-lg font-semibold">Détails du restaurant</h2>

          <label className="block text-sm font-medium">
            Nom du restaurant
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.restaurant_name}
              onChange={(e) =>
                onChangeField("restaurant_name", e.target.value)
              }
              placeholder="MMD African Food"
            />
          </label>

          <label className="block text-sm font-medium">
            Adresse
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.address ?? ""}
              onChange={(e) => onChangeField("address", e.target.value)}
              placeholder="123 Main St"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Ville
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1"
                value={profile.city ?? ""}
                onChange={(e) => onChangeField("city", e.target.value)}
                placeholder="Brooklyn"
              />
            </label>

            <label className="block text-sm font-medium">
              Code postal
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1"
                value={profile.postal_code ?? ""}
                onChange={(e) => onChangeField("postal_code", e.target.value)}
                placeholder="11226"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Type de cuisine
            <input
              type="text"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.cuisine_type ?? ""}
              onChange={(e) => onChangeField("cuisine_type", e.target.value)}
              placeholder="Africain, Italien, Fast-food…"
            />
          </label>

          <label className="block text-sm font-medium">
            Description (optionnel)
            <textarea
              className="mt-1 w-full border rounded px-2 py-1"
              rows={3}
              value={profile.description ?? ""}
              onChange={(e) => onChangeField("description", e.target.value)}
              placeholder="Description courte du restaurant, spécialités, etc."
            />
          </label>
        </div>

        {/* HORAIRES D’OUVERTURE */}
        <div className="space-y-3 pt-2 border-t pt-4">
          <h2 className="text-lg font-semibold">Horaires d’ouverture</h2>

          <div className="space-y-2 text-xs text-gray-600">
            <p>Indique les heures d'ouverture et de fermeture pour chaque jour.</p>
          </div>

          <div className="space-y-2">
            {(Object.keys(DAY_LABELS) as DayKey[]).map((day) => (
              <div
                key={day}
                className="grid grid-cols-1 sm:grid-cols-[120px,1fr,1fr] gap-2 items-center"
              >
                <div className="text-sm font-medium">{DAY_LABELS[day]}</div>
                <div>
                  <label className="text-xs text-gray-600">Ouverture</label>
                  <input
                    type="time"
                    className="mt-1 w-full border rounded px-2 py-1 text-sm"
                    value={openingHours[day].open}
                    onChange={(e) =>
                      onChangeOpeningHours(day, "open", e.target.value)
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Fermeture</label>
                  <input
                    type="time"
                    className="mt-1 w-full border rounded px-2 py-1 text-sm"
                    value={openingHours[day].close}
                    onChange={(e) =>
                      onChangeOpeningHours(day, "close", e.target.value)
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* OPTIONS DE LIVRAISON */}
        <div className="space-y-3 pt-2 border-t pt-4">
          <h2 className="text-lg font-semibold">Options de service</h2>

          <div className="flex flex-col sm:flex-row gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_delivery}
                onChange={(e) =>
                  onChangeOption("offers_delivery", e.target.checked)
                }
              />
              <span>Livraison</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_pickup}
                onChange={(e) =>
                  onChangeOption("offers_pickup", e.target.checked)
                }
              />
              <span>À emporter</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_dine_in}
                onChange={(e) =>
                  onChangeOption("offers_dine_in", e.target.checked)
                }
              />
              <span>Sur place</span>
            </label>
          </div>
        </div>

        {/* INFOS BUSINESS & PRÉSENCE EN LIGNE */}
        <div className="space-y-3 pt-2 border-t pt-4">
          <h2 className="text-lg font-semibold">Infos business</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              N° de licence
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1"
                value={profile.license_number ?? ""}
                onChange={(e) =>
                  onChangeField("license_number", e.target.value)
                }
                placeholder="Licence du restaurant"
              />
            </label>

            <label className="block text-sm font-medium">
              N° de Tax ID (EIN)
              <input
                type="text"
                className="mt-1 w-full border rounded px-2 py-1"
                value={profile.tax_id ?? ""}
                onChange={(e) => onChangeField("tax_id", e.target.value)}
                placeholder="00-0000000"
              />
            </label>
          </div>

          <h3 className="text-sm font-semibold pt-2">Présence en ligne</h3>

          <label className="block text-sm font-medium">
            Site web
            <input
              type="url"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.website ?? ""}
              onChange={(e) => onChangeField("website", e.target.value)}
              placeholder="https://monrestaurant.com"
            />
          </label>

          <label className="block text-sm font-medium">
            Instagram
            <input
              type="url"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.instagram ?? ""}
              onChange={(e) => onChangeField("instagram", e.target.value)}
              placeholder="https://instagram.com/monrestaurant"
            />
          </label>

          <label className="block text-sm font-medium">
            Facebook
            <input
              type="url"
              className="mt-1 w-full border rounded px-2 py-1"
              value={profile.facebook ?? ""}
              onChange={(e) => onChangeField("facebook", e.target.value)}
              placeholder="https://facebook.com/monrestaurant"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-4 inline-flex items-center px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer mon profil restaurant"}
        </button>
      </form>

      {/* DOCUMENTS RESTAURANT */}
      <div className="border rounded-lg p-4 space-y-4 bg-white">
        <h2 className="text-lg font-semibold">Vérification du restaurant</h2>
        <p className="text-sm text-gray-600">
          Ces documents servent à vérifier ton restaurant (logo + licence). Ils
          ne seront pas partagés avec les clients.
        </p>

        {/* Logo */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Logo du restaurant
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setLogoFile(e.target.files?.[0] ?? null)
            }
          />
          {docs.logo && (
            <p className="text-xs text-gray-700">
              Déjà envoyé • statut : {docs.logo.status ?? "pending"}
            </p>
          )}
          {uploadingDoc === "logo" && (
            <p className="text-xs text-gray-500">Upload en cours…</p>
          )}
        </div>

        {/* Licence */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Licence / Business document
          </label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setLicenseFile(e.target.files?.[0] ?? null)
            }
          />
          {docs.business_license && (
            <p className="text-xs text-gray-700">
              Déjà envoyée • statut :{" "}
              {docs.business_license.status ?? "pending"}
            </p>
          )}
          {uploadingDoc === "business_license" && (
            <p className="text-xs text-gray-500">Upload en cours…</p>
          )}
        </div>

        {/* Autre document */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">
            Autre document (optionnel)
          </label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setOtherFile(e.target.files?.[0] ?? null)
            }
          />
          {docs.other && (
            <p className="text-xs text-gray-700">
              Déjà envoyé • statut : {docs.other.status ?? "pending"}
            </p>
          )}
          {uploadingDoc === "other" && (
            <p className="text-xs text-gray-500">Upload en cours…</p>
          )}
        </div>
      </div>
    </div>
  );
}
