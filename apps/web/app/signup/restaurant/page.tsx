"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "restaurant";

type BusinessType = "" | "individual" | "llc" | "corporation" | "nonprofit";

export default function SignupRestaurant() {
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  // Email pour envoyer le lien
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Email réel après connexion (lecture seule)
  const [authEmail, setAuthEmail] = useState("");

  // Infos légales / business
  const [legalName, setLegalName] = useState("");          // restaurant_legal_name
  const [displayName, setDisplayName] = useState("");      // restaurant_display_name
  const [businessType, setBusinessType] = useState<BusinessType>(""); // LLC, etc.
  const [ein, setEin] = useState("");                      // restaurant_ein

  // Infos restaurant
  const [cuisineType, setCuisineType] = useState("");      // restaurant_cuisine_type
  const [description, setDescription] = useState("");      // restaurant_description

  // Adresse
  const [address, setAddress] = useState("");              // restaurant_address
  const [city, setCity] = useState("");                    // restaurant_city
  const [state, setState] = useState("");                  // restaurant_state
  const [zip, setZip] = useState("");                      // restaurant_zip

  // Contact / téléphone
  const [restaurantPhone, setRestaurantPhone] = useState("");   // restaurant_phone
  const [contactName, setContactName] = useState("");           // restaurant_contact_name
  const [contactPhone, setContactPhone] = useState("");         // restaurant_contact_phone

  // Opérations
  const [hasPickup, setHasPickup] = useState(true);     // restaurant_has_pickup
  const [hasDelivery, setHasDelivery] = useState(true); // restaurant_has_delivery
  const [prepTime, setPrepTime] = useState<number | "">(""); // restaurant_prep_time_minutes
  const [openingHours, setOpeningHours] = useState("");      // restaurant_opening_hours (texte libre)

  // Logo / photo
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // Récupérer la session (user connecté)
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

  // Envoi du lien magique pour le restaurant
  async function sendLink() {
    setErr(null);
    try {
      if (!email) {
        setErr("Merci de saisir un email.");
        return;
      }

      const redirect = `${window.location.origin}/auth/callback?next=/signup/restaurant`;

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

  // Sauvegarde du profil restaurant (création OU mise à jour)
  async function saveProfile() {
    setErr(null);

    if (!uid) {
      setErr("Tu dois être connecté pour enregistrer le profil restaurant.");
      return;
    }

    // ✅ Validations "sérieuses" façon Uber
    if (!legalName.trim()) {
      setErr("Merci de saisir le nom légal du restaurant.");
      return;
    }

    if (!displayName.trim()) {
      setErr("Merci de saisir le nom affiché dans l’app.");
      return;
    }

    if (!businessType) {
      setErr("Merci de choisir le type de structure (LLC, Corporation…).");
      return;
    }

    if (!ein.trim()) {
      setErr("Merci de saisir l’EIN du restaurant.");
      return;
    }

    if (!cuisineType.trim()) {
      setErr("Merci de préciser le type de cuisine (Africain, Pizza, Fast-food…).");
      return;
    }

    if (!address.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setErr("Merci de remplir l’adresse complète du restaurant.");
      return;
    }

    if (!restaurantPhone.trim()) {
      setErr("Merci de saisir le téléphone du restaurant.");
      return;
    }

    if (!contactName.trim()) {
      setErr("Merci de saisir le nom du contact principal.");
      return;
    }

    if (!contactPhone.trim()) {
      setErr("Merci de saisir le téléphone du contact principal.");
      return;
    }

    if (!prepTime || typeof prepTime !== "number" || prepTime <= 0) {
      setErr("Merci d’indiquer un temps moyen de préparation (en minutes).");
      return;
    }

    setSaving(true);

    try {
      // 1️⃣ Upload du logo / photo SI un nouveau fichier est choisi
      let restaurant_logo_url: string | null | undefined = undefined;

      if (logoFile) {
        const ext = logoFile.name.split(".").pop() || "jpg";
        const path = `restaurants/${uid}/${Date.now()}.${ext}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, logoFile, {
            upsert: true,
          });

        if (uploadError) {
          console.error(uploadError);
          throw uploadError;
        }

        restaurant_logo_url = uploadData?.path ?? null;
      }

      // 2️⃣ UPSERT dans profiles (insert OU update si déjà existant)
      const payload: any = {
        id: uid, // = auth.users.id
        role: ROLE,

        restaurant_legal_name: legalName || null,
        restaurant_display_name: displayName || null,
        restaurant_business_type: businessType || null,
        restaurant_ein: ein || null,

        restaurant_cuisine_type: cuisineType || null,
        restaurant_description: description || null,

        restaurant_address: address || null,
        restaurant_city: city || null,
        restaurant_state: state || null,
        restaurant_zip: zip || null,

        restaurant_phone: restaurantPhone || null,
        restaurant_contact_name: contactName || null,
        restaurant_contact_phone: contactPhone || null,

        restaurant_has_pickup: hasPickup,
        restaurant_has_delivery: hasDelivery,
        restaurant_prep_time_minutes:
          typeof prepTime === "number" ? prepTime : null,
        restaurant_opening_hours: openingHours || null,
      };

      if (restaurant_logo_url !== undefined) {
        payload.restaurant_logo_url = restaurant_logo_url;
      }

      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" });

      if (upsertErr) {
        console.error(upsertErr);
        setErr(
          upsertErr.message ??
            "Erreur lors de l'enregistrement du profil restaurant."
        );
        return;
      }

      alert("Profil restaurant enregistré / mis à jour ✅");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur lors de l'enregistrement du profil restaurant.");
    } finally {
      setSaving(false);
    }
  }

  // 👀 Écran 1 : pas connecté → lien magique
  if (!uid) {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4">
        <h1 className="text-xl font-semibold">Créer un compte — restaurant</h1>
        <p className="text-sm text-gray-600">
          Entre l’email du restaurant pour créer le compte et continuer l’inscription.
        </p>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="email du restaurant"
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

  // 👤 Écran 2 : connecté → profil restaurant complet
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Profil du restaurant</h1>

      {/* Email (non modifiable) */}
      {authEmail && (
        <section className="space-y-1">
          <h2 className="text-sm font-medium text-gray-700">Compte</h2>
          <input
            className="w-full border rounded px-3 py-2 bg-gray-100"
            value={authEmail}
            disabled
          />
        </section>
      )}

      {/* Bloc 1 : Informations légales */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">
          Informations légales
        </h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Nom légal du restaurant (sur les papiers officiels)"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Nom affiché dans l’app (ex: MMD African Grill)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />

        <div className="flex flex-col md:flex-row gap-2">
          <select
            className="md:w-1/2 border rounded px-3 py-2"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value as BusinessType)}
          >
            <option value="">Type de structure</option>
            <option value="individual">Individuel / Sole proprietor</option>
            <option value="llc">LLC</option>
            <option value="corporation">Corporation</option>
            <option value="nonprofit">Association / Non-profit</option>
          </select>
          <input
            className="md:w-1/2 border rounded px-3 py-2"
            placeholder="EIN du restaurant"
            value={ein}
            onChange={(e) => setEin(e.target.value)}
          />
        </div>
      </section>

      {/* Bloc 2 : Restaurant & cuisine */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">
          Détails du restaurant
        </h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Type de cuisine (Africain, Italien, Pizza, Fast-food…)"
          value={cuisineType}
          onChange={(e) => setCuisineType(e.target.value)}
        />
        <textarea
          className="w-full border rounded px-3 py-2 min-h-[70px]"
          placeholder="Courte description (ex: Spécialités africaines, grillades, plats faits maison…) "
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </section>

      {/* Bloc 3 : Adresse */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">Adresse</h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Adresse (rue, numéro)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Ville"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="w-1/2 border rounded px-3 py-2"
            placeholder="État (ex: NY)"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
          <input
            className="w-1/2 border rounded px-3 py-2"
            placeholder="ZIP code"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
          />
        </div>
      </section>

      {/* Bloc 4 : Contacts */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">Contacts</h2>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Téléphone du restaurant"
          value={restaurantPhone}
          onChange={(e) => setRestaurantPhone(e.target.value)}
        />
        <div className="flex flex-col md:flex-row gap-2">
          <input
            className="md:w-1/2 border rounded px-3 py-2"
            placeholder="Nom du contact principal"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
          <input
            className="md:w-1/2 border rounded px-3 py-2"
            placeholder="Téléphone du contact principal"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
      </section>

      {/* Bloc 5 : Options de livraison & horaires */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">
          Livraison & horaires
        </h2>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasPickup}
              onChange={(e) => setHasPickup(e.target.checked)}
            />
            Retrait sur place (pickup)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasDelivery}
              onChange={(e) => setHasDelivery(e.target.checked)}
            />
            Livraison avec MMD Delivery
          </label>
        </div>

        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Temps moyen de préparation (en minutes, ex: 20)"
          value={prepTime === "" ? "" : String(prepTime)}
          onChange={(e) =>
            setPrepTime(e.target.value === "" ? "" : Number(e.target.value))
          }
        />

        <textarea
          className="w-full border rounded px-3 py-2 min-h-[70px]"
          placeholder="Horaires d’ouverture (ex: Lun–Dim : 11h00–23h00)"
          value={openingHours}
          onChange={(e) => setOpeningHours(e.target.value)}
        />
      </section>

      {/* Bloc 6 : Logo / Photo */}
      <section className="space-y-2 border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-800">
          Logo / photo du restaurant
        </h2>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setLogoFile(file);
            if (file) {
              setLogoPreview(URL.createObjectURL(file));
            } else {
              setLogoPreview(null);
            }
          }}
        />
        {logoPreview && (
          <img
            src={logoPreview}
            alt="Aperçu du logo"
            className="mt-2 h-24 w-24 rounded-full object-cover border"
          />
        )}
      </section>

      <button
        onClick={saveProfile}
        className="px-4 py-2 rounded bg-black text-white w-full md:w-auto"
        disabled={saving}
      >
        {saving ? "Enregistrement..." : "Enregistrer le profil restaurant"}
      </button>

      {err && <div className="text-red-600 text-sm">{err}</div>}
    </div>
  );
}
