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
  restaurant_logo_url: string | null;
  cover_image_url: string | null;
  offers_delivery: boolean;
  offers_pickup: boolean;
  offers_dine_in: boolean;
};

type RestaurantDocType = "license" | "tax" | "id";

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

function getFileExtension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName) return fromName;

  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function getLogoPublicUrl(path: string): string | null {
  return supabase.storage.from("avatars").getPublicUrl(path)?.data?.publicUrl ?? null;
}

export default function RestaurantProfilePage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [profile, setProfile] = useState<RestaurantProfileRow | null>(null);
  const [docs, setDocs] = useState<Record<RestaurantDocType, RestaurantDocumentRow | null>>({
    license: null,
    tax: null,
    id: null,
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [taxFile, setTaxFile] = useState<File | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);

  const [openingHours, setOpeningHours] = useState<OpeningHours>(() =>
    getDefaultOpeningHours()
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<RestaurantDocType | "logo" | "cover" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

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
          router.push("/signup/restaurant");
        }
        setLoading(false);
        return;
      }

      const uid = user.id;
      if (cancelled) return;
      setUserId(uid);

      const initialAccount: AccountInfo = {
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

      if (!cancelled) setAccount(initialAccount);

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
        restaurant_logo_url: rpRow?.restaurant_logo_url ?? null,
        cover_image_url: (rpRow as any)?.cover_image_url ?? null,
        offers_delivery:
          rpRow?.offers_delivery === undefined ? true : !!rpRow.offers_delivery,
        offers_pickup:
          rpRow?.offers_pickup === undefined ? true : !!rpRow.offers_pickup,
        offers_dine_in:
          rpRow?.offers_dine_in === undefined ? false : !!rpRow.offers_dine_in,
      };

      const { data: docsData, error: docsError } = await supabase
        .from("restaurant_documents")
        .select("*")
        .eq("user_id", uid);

      if (docsError) {
        console.error(docsError);
        if (!cancelled) setErr(docsError.message);
      }

      const docState: Record<RestaurantDocType, RestaurantDocumentRow | null> = {
        license: null,
        tax: null,
        id: null,
      };

      docsData?.forEach((row: any) => {
        if (row.doc_type === "license") docState.license = row;
        if (row.doc_type === "tax") docState.tax = row;
        if (row.doc_type === "id") docState.id = row;
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
    setProfile({ ...profile, [field]: value || "" });
  }

  function onChangeOption(
    field: "offers_delivery" | "offers_pickup" | "offers_dine_in",
    value: boolean
  ) {
    if (!profile) return;
    setProfile({ ...profile, [field]: value });
  }

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

  async function uploadLogo(file: File): Promise<string | null> {
    if (!userId) return null;
    setUploadingDoc("logo");

    try {
      const ext = getFileExtension(file);
      const path = `restaurants/${userId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, {
          contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          upsert: true,
        });

      if (uploadError) {
        console.error(uploadError);
        setErr(uploadError.message);
        return null;
      }

      return getLogoPublicUrl(path);
    } finally {
      setUploadingDoc(null);
    }
  }

  async function uploadCover(file: File): Promise<string | null> {
    if (!userId) return null;
    setUploadingDoc("cover");

    try {
      const ext = getFileExtension(file);
      const path = `restaurants/${userId}/cover.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, {
          contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          upsert: true,
        });

      if (uploadError) {
        console.error(uploadError);
        setErr(uploadError.message);
        return null;
      }

      return getLogoPublicUrl(path);
    } finally {
      setUploadingDoc(null);
    }
  }

  async function uploadOneDoc(
    docType: RestaurantDocType,
    file: File
  ): Promise<RestaurantDocumentRow | null> {
    if (!userId) return null;
    setUploadingDoc(docType);

    try {
      const ext = getFileExtension(file);
      const path = `${userId}/${docType}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("restaurant-docs")
        .upload(path, file, {
          contentType:
            file.type ||
            (ext === "pdf"
              ? "application/pdf"
              : ext === "png"
                ? "image/png"
                : ext === "webp"
                  ? "image/webp"
                  : "image/jpeg"),
          upsert: true,
        });

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
            reviewed_at: null,
            reviewed_by: null,
            review_notes: null,
          },
          { onConflict: "user_id,doc_type" }
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !profile) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      if (!profile.restaurant_name.trim()) {
        throw new Error("Merci de saisir le nom du restaurant.");
      }

      if (!profile.phone?.trim()) {
        throw new Error("Merci de saisir le téléphone du restaurant.");
      }

      if (!profile.address?.trim() || !profile.city?.trim() || !profile.postal_code?.trim()) {
        throw new Error("Merci de saisir l’adresse complète du restaurant.");
      }

      if (!profile.cuisine_type?.trim()) {
        throw new Error("Merci de saisir le type de cuisine.");
      }

      if (account) {
        const { error: accError } = await supabase
          .from("profiles")
          .update({ full_name: account.full_name })
          .eq("id", userId);

        if (accError) throw new Error(accError.message);
      }

      let nextLogoUrl = profile.restaurant_logo_url;
      let nextCoverUrl = profile.cover_image_url;

      if (logoFile) {
        const uploadedLogoUrl = await uploadLogo(logoFile);
        if (uploadedLogoUrl) nextLogoUrl = uploadedLogoUrl;
      }

      if (coverFile) {
        const uploadedCoverUrl = await uploadCover(coverFile);
        if (uploadedCoverUrl) nextCoverUrl = uploadedCoverUrl;
      }

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
        restaurant_logo_url: nextLogoUrl,
        cover_image_url: nextCoverUrl,
        offers_delivery: profile.offers_delivery,
        offers_pickup: profile.offers_pickup,
        offers_dine_in: profile.offers_dine_in,
        opening_hours: openingHours,
        // Never force an approved/suspended restaurant back to pending on ordinary edits.
        // Self-write SQL guard also locks admin statuses; keep payload consistent.
        updated_at: new Date().toISOString(),
      };

      const { data: existingProfile } = await supabase
        .from("restaurant_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      const existingStatus = String(existingProfile?.status ?? "").toLowerCase();
      const payloadWithStatus = {
        ...payload,
        status:
          existingStatus === "approved" ||
          existingStatus === "suspended" ||
          existingStatus === "disabled"
            ? existingStatus
            : "pending",
      };

      const { error } = await supabase
        .from("restaurant_profiles")
        .upsert(payloadWithStatus, { onConflict: "user_id" });

      if (error) throw new Error(error.message);

      let hadUploadError = false;
      const newDocs: Record<RestaurantDocType, RestaurantDocumentRow | null> = {
        ...docs,
      };

      if (licenseFile) {
        const row = await uploadOneDoc("license", licenseFile);
        if (!row) hadUploadError = true;
        else newDocs.license = row;
      }

      if (taxFile) {
        const row = await uploadOneDoc("tax", taxFile);
        if (!row) hadUploadError = true;
        else newDocs.tax = row;
      }

      if (idFile) {
        const row = await uploadOneDoc("id", idFile);
        if (!row) hadUploadError = true;
        else newDocs.id = row;
      }

      setDocs(newDocs);
      setLogoFile(null);
      setCoverFile(null);
      setLicenseFile(null);
      setTaxFile(null);
      setIdFile(null);
      setProfile({
        ...profile,
        restaurant_logo_url: nextLogoUrl,
        cover_image_url: nextCoverUrl,
      });

      if (!hadUploadError) {
        setOk("Profil restaurant enregistré avec succès ✅");
      } else {
        setOk("Profil enregistré, mais une erreur est survenue lors de l’envoi de certains documents.");
      }
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setSaving(false);
    }
  }

  function handleLogoChange(file: File | null) {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleCoverChange(file: File | null) {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverFile(file);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  }

  if (loading || !profile) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <h1 className="mb-2 text-xl font-semibold">Profil restaurant</h1>
        <p>Chargement…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <h1 className="mb-2 text-xl font-semibold">Profil restaurant</h1>
        <p>Tu dois être connecté pour voir cette page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">
          MMD Restaurant
        </p>
        <h1 className="text-2xl font-black tracking-tight">Profil restaurant</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">
          Configure ton restaurant, tes horaires, ton logo et tes documents de vérification.
        </p>
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{err}</p>}
      {ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{ok}</p>}

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Compte & contact</h2>

          <label className="block text-sm font-medium">
            Nom complet (propriétaire / contact)
            <input
              type="text"
              className="mt-1 w-full rounded border px-3 py-2"
              value={account?.full_name ?? ""}
              onChange={(event) =>
                setAccount((prev) =>
                  prev
                    ? { ...prev, full_name: event.target.value }
                    : { full_name: event.target.value, email: profile.email }
                )
              }
              placeholder="Nom du propriétaire ou contact principal"
            />
          </label>

          <label className="block text-sm font-medium">
            Email de contact
            <input
              type="email"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.email ?? ""}
              onChange={(event) => onChangeField("email", event.target.value)}
              placeholder="contact@monrestaurant.com"
            />
          </label>

          <label className="block text-sm font-medium">
            Téléphone du restaurant
            <input
              type="tel"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.phone ?? ""}
              onChange={(event) => onChangeField("phone", event.target.value)}
              placeholder="929 000 0000"
            />
          </label>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Détails du restaurant</h2>

          <label className="block text-sm font-medium">
            Nom du restaurant
            <input
              type="text"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.restaurant_name}
              onChange={(event) => onChangeField("restaurant_name", event.target.value)}
              placeholder="MMD African Food"
            />
          </label>

          <label className="block text-sm font-medium">
            Adresse
            <input
              type="text"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.address ?? ""}
              onChange={(event) => onChangeField("address", event.target.value)}
              placeholder="123 Main St"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Ville
              <input
                type="text"
                className="mt-1 w-full rounded border px-3 py-2"
                value={profile.city ?? ""}
                onChange={(event) => onChangeField("city", event.target.value)}
                placeholder="Brooklyn"
              />
            </label>

            <label className="block text-sm font-medium">
              Code postal
              <input
                type="text"
                className="mt-1 w-full rounded border px-3 py-2"
                value={profile.postal_code ?? ""}
                onChange={(event) => onChangeField("postal_code", event.target.value)}
                placeholder="11226"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Type de cuisine
            <input
              type="text"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.cuisine_type ?? ""}
              onChange={(event) => onChangeField("cuisine_type", event.target.value)}
              placeholder="Africain, Italien, Fast-food…"
            />
          </label>

          <label className="block text-sm font-medium">
            Description (optionnel)
            <textarea
              className="mt-1 w-full rounded border px-3 py-2"
              rows={3}
              value={profile.description ?? ""}
              onChange={(event) => onChangeField("description", event.target.value)}
              placeholder="Description courte du restaurant, spécialités, etc."
            />
          </label>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Logo du restaurant</h2>
          <p className="text-sm text-gray-600">
            Le logo est public et sera affiché aux clients dans MMD. Il est stocké dans le profil restaurant, pas comme document légal.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border bg-gray-50 text-xl font-black text-gray-400">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="Aperçu logo" className="h-full w-full object-cover" />
              ) : profile.restaurant_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.restaurant_logo_url} alt="Logo restaurant" className="h-full w-full object-cover" />
              ) : (
                "+"
              )}
            </div>

            <input
              type="file"
              accept="image/*"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleLogoChange(event.target.files?.[0] ?? null)
              }
            />
          </div>
          {uploadingDoc === "logo" && <p className="text-xs text-gray-500">Upload logo en cours…</p>}
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Image de couverture</h2>
          <p className="text-sm text-gray-600">
            Bannière affichée aux clients. Stockée sur le profil restaurant (`cover_image_url`).
          </p>

          <div className="flex flex-col gap-3">
            <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl border bg-gray-50 text-xl font-black text-gray-400">
              {coverPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPreview} alt="Aperçu couverture" className="h-full w-full object-cover" />
              ) : profile.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.cover_image_url} alt="Couverture restaurant" className="h-full w-full object-cover" />
              ) : (
                "Couverture"
              )}
            </div>

            <input
              type="file"
              accept="image/*"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handleCoverChange(event.target.files?.[0] ?? null)
              }
            />
          </div>
          {uploadingDoc === "cover" && <p className="text-xs text-gray-500">Upload couverture en cours…</p>}
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Horaires d’ouverture</h2>
          <p className="text-xs text-gray-600">Indique les heures d'ouverture et de fermeture pour chaque jour.</p>

          <div className="space-y-2">
            {(Object.keys(DAY_LABELS) as DayKey[]).map((day) => (
              <div key={day} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[120px,1fr,1fr]">
                <div className="text-sm font-medium">{DAY_LABELS[day]}</div>
                <div>
                  <label className="text-xs text-gray-600">Ouverture</label>
                  <input
                    type="time"
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={openingHours[day].open}
                    onChange={(event) => onChangeOpeningHours(day, "open", event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Fermeture</label>
                  <input
                    type="time"
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={openingHours[day].close}
                    onChange={(event) => onChangeOpeningHours(day, "close", event.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Options de service</h2>

          <div className="flex flex-col gap-3 text-sm sm:flex-row">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_delivery}
                onChange={(event) => onChangeOption("offers_delivery", event.target.checked)}
              />
              <span>Livraison</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_pickup}
                onChange={(event) => onChangeOption("offers_pickup", event.target.checked)}
              />
              <span>À emporter</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profile.offers_dine_in}
                onChange={(event) => onChangeOption("offers_dine_in", event.target.checked)}
              />
              <span>Sur place</span>
            </label>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">Infos business</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              N° de licence
              <input
                type="text"
                className="mt-1 w-full rounded border px-3 py-2"
                value={profile.license_number ?? ""}
                onChange={(event) => onChangeField("license_number", event.target.value)}
                placeholder="Licence du restaurant"
              />
            </label>

            <label className="block text-sm font-medium">
              N° de Tax ID (EIN)
              <input
                type="text"
                className="mt-1 w-full rounded border px-3 py-2"
                value={profile.tax_id ?? ""}
                onChange={(event) => onChangeField("tax_id", event.target.value)}
                placeholder="00-0000000"
              />
            </label>
          </div>

          <h3 className="pt-2 text-sm font-semibold">Présence en ligne</h3>

          <label className="block text-sm font-medium">
            Site web
            <input
              type="url"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.website ?? ""}
              onChange={(event) => onChangeField("website", event.target.value)}
              placeholder="https://monrestaurant.com"
            />
          </label>

          <label className="block text-sm font-medium">
            Instagram
            <input
              type="url"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.instagram ?? ""}
              onChange={(event) => onChangeField("instagram", event.target.value)}
              placeholder="https://instagram.com/monrestaurant"
            />
          </label>

          <label className="block text-sm font-medium">
            Facebook
            <input
              type="url"
              className="mt-1 w-full rounded border px-3 py-2"
              value={profile.facebook ?? ""}
              onChange={(event) => onChangeField("facebook", event.target.value)}
              placeholder="https://facebook.com/monrestaurant"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-4 inline-flex items-center rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer mon profil restaurant"}
        </button>
      </form>

      <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Documents de vérification</h2>
          <p className="text-sm text-gray-600">
            Ces documents servent à vérifier ton restaurant. Ils restent privés et suivent les mêmes types que le backend Supabase : license, tax, id.
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Licence restaurant</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setLicenseFile(event.target.files?.[0] ?? null)}
          />
          {docs.license && (
            <p className="text-xs text-gray-700">Déjà envoyée • statut : {docs.license.status ?? "pending"}</p>
          )}
          {uploadingDoc === "license" && <p className="text-xs text-gray-500">Upload en cours…</p>}
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Document fiscal / EIN</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTaxFile(event.target.files?.[0] ?? null)}
          />
          {docs.tax && (
            <p className="text-xs text-gray-700">Déjà envoyé • statut : {docs.tax.status ?? "pending"}</p>
          )}
          {uploadingDoc === "tax" && <p className="text-xs text-gray-500">Upload en cours…</p>}
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium">Pièce d’identité propriétaire</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setIdFile(event.target.files?.[0] ?? null)}
          />
          {docs.id && (
            <p className="text-xs text-gray-700">Déjà envoyée • statut : {docs.id.status ?? "pending"}</p>
          )}
          {uploadingDoc === "id" && <p className="text-xs text-gray-500">Upload en cours…</p>}
        </div>
      </div>
    </div>
  );
}
