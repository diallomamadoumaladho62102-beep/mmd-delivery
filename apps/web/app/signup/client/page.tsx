"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "client";
const RESET_PASSWORD_URL = "https://mmd-delivery.vercel.app/auth/reset-password";

type Mode = "login" | "signup";

function normalizeReferralCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^ref=/i, "")
    .replace(/^code=/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();

  return cleaned.length >= 4 ? cleaned : null;
}

function extractReferralCodeFromCurrentUrl(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const url = new URL(window.location.href);
    const fromRef = normalizeReferralCode(url.searchParams.get("ref"));
    if (fromRef) return fromRef;

    const fromCode = normalizeReferralCode(url.searchParams.get("code"));
    if (fromCode) return fromCode;

    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    const rIndex = parts.findIndex((part) => part.toLowerCase() === "r");

    if (rIndex >= 0 && parts[rIndex + 1]) {
      return normalizeReferralCode(parts[rIndex + 1]);
    }

    if (parts.length >= 2 && parts[0]?.toLowerCase() === "signup") {
      return normalizeReferralCode(parts[1]);
    }

    return null;
  } catch {
    return null;
  }
}

function cleanPhone(value: string): string {
  return value.trim().replace(/[^\d+]/g, "");
}

function trimOrEmpty(value: string): string {
  return value.trim();
}

function getExtFromFile(file: File): string {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type.includes("png") || name.endsWith(".png")) return "png";
  if (type.includes("webp") || name.endsWith(".webp")) return "webp";
  return "jpg";
}

async function uploadAvatarToSupabase(params: {
  userId: string;
  file: File;
}): Promise<{ publicUrl: string | null; path: string }> {
  const { userId, file } = params;
  const bucket = "avatars";
  const ext = getExtFromFile(file);
  const path = `clients/${userId}/avatar.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
    upsert: true,
  });

  if (error) throw error;

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl ?? null;

  return { publicUrl, path };
}

export default function SignupClientPage() {
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [referralCode, setReferralCode] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const code = extractReferralCodeFromCurrentUrl();

    if (code) {
      setReferralCode(code);
      setMode("signup");
    }

    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = useMemo(
    () => (mode === "login" ? "Connexion client" : "Créer un compte client"),
    [mode]
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? "Connecte-toi avec ton compte client MMD."
        : "Crée ton compte client, ajoute ton adresse et commence à commander.",
    [mode]
  );

  async function applyReferralIfAny() {
    const code = normalizeReferralCode(referralCode);
    if (!code) return;

    const { data, error } = await supabase.rpc("accept_referral_code", {
      p_code: code,
    });

    if (error) {
      console.log("accept_referral_code error", error);
      return;
    }

    if (data && (data as { ok?: boolean; error?: string }).ok === false) {
      console.log("referral not applied:", (data as { ok?: boolean; error?: string }).error);
    }
  }

  async function saveClientProfile(params: {
    userId: string;
    email: string;
    avatarUrl: string | null;
  }) {
    const { userId, email: userEmail, avatarUrl } = params;

    try {
      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: userId,
          role: ROLE,
          full_name: trimOrEmpty(fullName),
          phone: cleanPhone(phone),
          email: userEmail,
          avatar_url: avatarUrl,
        },
        { onConflict: "id" }
      );

      if (profileError) {
        console.log("profiles upsert error:", profileError);
      }
    } catch (error) {
      console.log("profiles upsert exception:", error);
    }

    try {
      await supabase.auth.updateUser({
        data: {
          role: ROLE,
          email: userEmail,
          full_name: trimOrEmpty(fullName),
          phone: cleanPhone(phone),
          address_line1: trimOrEmpty(addressLine1),
          address_line2: trimOrEmpty(addressLine2),
          city: trimOrEmpty(city),
          state: trimOrEmpty(stateRegion),
          postal_code: trimOrEmpty(postalCode),
          country: trimOrEmpty(country || "US"),
          avatar_url: avatarUrl,
        },
      });
    } catch (error) {
      console.log("updateUser metadata error:", error);
    }

    const fullAddress = [
      trimOrEmpty(addressLine1),
      trimOrEmpty(addressLine2),
      `${trimOrEmpty(city)} ${trimOrEmpty(stateRegion)} ${trimOrEmpty(postalCode)}`.trim(),
      trimOrEmpty(country || "US"),
    ]
      .filter(Boolean)
      .join(", ");

    try {
      const payload = {
        user_id: userId,
        phone: cleanPhone(phone),
        default_address: fullAddress,
        full_name: trimOrEmpty(fullName),
        avatar_url: avatarUrl,
        city: trimOrEmpty(city),
        state: trimOrEmpty(stateRegion),
        postal_code: trimOrEmpty(postalCode),
        country: trimOrEmpty(country || "US"),
      };

      const { error } = await supabase
        .from("client_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (error) {
        console.log("client_profiles upsert error:", error);
        throw error;
      }
    } catch (error) {
      console.log("client_profiles upsert exception:", error);
      throw error;
    }

    try {
      await supabase
        .from("client_addresses")
        .update({ is_default: false })
        .eq("user_id", userId)
        .eq("is_default", true);

      const { error } = await supabase.from("client_addresses").insert({
        user_id: userId,
        label: "Main address",
        address_line1: trimOrEmpty(addressLine1),
        address_line2: trimOrEmpty(addressLine2),
        city: trimOrEmpty(city),
        state: trimOrEmpty(stateRegion),
        postal_code: trimOrEmpty(postalCode),
        country: trimOrEmpty(country || "US"),
        is_default: true,
      });

      if (error) {
        console.log("client_addresses insert error:", error);
        throw error;
      }
    } catch (error) {
      console.log("client_addresses insert exception:", error);
      throw error;
    }
  }

  async function handleLogin() {
    setErr(null);
    setMessage(null);

    const e = email.trim().toLowerCase();

    if (!e || !password.trim()) {
      setErr("Email et mot de passe obligatoires.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });

      if (error) throw new Error(error.message || "Connexion impossible.");
      if (!data.session) throw new Error("Session non créée. Réessaie.");

      await applyReferralIfAny();
      setMessage("Connexion réussie ✅");
      window.location.href = "/orders/new";
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setErr(null);
    setMessage(null);

    const e = email.trim().toLowerCase();
    if (!e) {
      setErr("Entre ton email avant de demander la réinitialisation.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: RESET_PASSWORD_URL,
      });

      if (error) throw new Error(error.message);
      setMessage("Email envoyé ✅ Vérifie ta boîte email pour modifier ton mot de passe.");
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Impossible d’envoyer l’email.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    setErr(null);
    setMessage(null);

    const e = email.trim().toLowerCase();

    if (!e || !password.trim()) {
      setErr("Email et mot de passe obligatoires.");
      return;
    }

    if (password.trim().length < 6) {
      setErr("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    if (!trimOrEmpty(fullName)) {
      setErr("Merci de saisir ton nom complet.");
      return;
    }

    const cleanedPhone = cleanPhone(phone);
    if (!cleanedPhone) {
      setErr("Merci de saisir ton numéro de téléphone.");
      return;
    }

    if (
      !trimOrEmpty(addressLine1) ||
      !trimOrEmpty(city) ||
      !trimOrEmpty(stateRegion) ||
      !trimOrEmpty(postalCode)
    ) {
      setErr("Merci de saisir ton adresse complète.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: e,
        password,
        options: {
          data: {
            role: ROLE,
            full_name: trimOrEmpty(fullName),
            phone: cleanedPhone,
            address_line1: trimOrEmpty(addressLine1),
            address_line2: trimOrEmpty(addressLine2),
            city: trimOrEmpty(city),
            state: trimOrEmpty(stateRegion),
            postal_code: trimOrEmpty(postalCode),
            country: trimOrEmpty(country || "US"),
            referral_code: normalizeReferralCode(referralCode),
          },
        },
      });

      if (error) throw new Error(error.message || "Inscription impossible.");

      const userId = data.user?.id;
      if (!userId) {
        setMessage("Compte créé ✅ Connecte-toi maintenant.");
        setMode("login");
        return;
      }

      let avatarUrl: string | null = null;

      if (avatarFile) {
        try {
          const uploaded = await uploadAvatarToSupabase({ userId, file: avatarFile });
          avatarUrl = uploaded.path;
        } catch (error) {
          console.log("avatar upload error:", error);
          setMessage("Compte créé, mais la photo n’a pas été envoyée. Tu pourras l’ajouter plus tard.");
        }
      }

      await saveClientProfile({ userId, email: e, avatarUrl });
      await applyReferralIfAny();

      if (!data.session) {
        setMessage("Compte créé ✅ Vérifie ton email, puis connecte-toi.");
        setMode("login");
        return;
      }

      setMessage("Compte client créé ✅");
      window.location.href = "/orders/new";
    } catch (error) {
      console.error(error);
      setErr(error instanceof Error ? error.message : "Inscription impossible.");
    } finally {
      setLoading(false);
    }
  }

  function onAvatarChange(file: File | null) {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-white">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl grid-cols-1 items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-extrabold text-slate-300">
            <span>🛍️</span>
            <span>MMD Client Access</span>
          </div>

          <h1 className="mt-6 text-5xl font-black leading-tight tracking-tight xl:text-7xl">
            Order faster with MMD Delivery.
          </h1>

          <p className="mt-5 max-w-xl text-lg font-semibold leading-8 text-slate-400">
            Create your client account, save your main address, and order food,
            delivery and services from one modern platform.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {["Secure account", "Saved address", "Referral ready", "Fast checkout"].map((item) => (
              <span
                key={item}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-extrabold text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur md:p-8">
          <div className="mb-7 text-center">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-red-300">
              Client account
            </p>
            <h2 className="text-3xl font-black tracking-tight md:text-5xl">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-400 md:text-base">
              {subtitle}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/80 p-2">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                mode === "login" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                mode === "signup" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Créer un compte
            </button>
          </div>

          {mode === "signup" && (
            <div className="mb-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-200">Photo de profil</label>
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-950 text-2xl font-black text-slate-500">
                    {avatarPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                    ) : (
                      "+"
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => onAvatarChange(event.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-bold file:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-200">Nom complet</label>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Ton nom complet"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-200">Téléphone</label>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555 000 0000"
                  inputMode="tel"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-200">Adresse</label>
                <input
                  value={addressLine1}
                  onChange={(event) => setAddressLine1(event.target.value)}
                  placeholder="Rue, numéro"
                  className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
                <input
                  value={addressLine2}
                  onChange={(event) => setAddressLine2(event.target.value)}
                  placeholder="Appartement, étage (optionnel)"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Ville"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
                <input
                  value={stateRegion}
                  onChange={(event) => setStateRegion(event.target.value.toUpperCase())}
                  placeholder="État"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold uppercase outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
                <input
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  placeholder="ZIP code"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
                <input
                  value={country}
                  onChange={(event) => setCountry(event.target.value.toUpperCase())}
                  placeholder="Pays"
                  className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold uppercase outline-none transition placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-200">Referral code</label>
                <input
                  value={referralCode}
                  onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                  placeholder="MMD referral code"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold uppercase outline-none transition placeholder:text-slate-600 focus:border-purple-500"
                />
                <p className="mt-2 text-xs font-bold text-slate-500">
                  Si tu ouvres un lien referral MMD, le code apparaît ici automatiquement.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-200">Email</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ton@email.com"
                type="email"
                autoComplete="email"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-200">Mot de passe</label>
              <div className="relative">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 6 caractères"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  disabled={loading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-24 font-semibold outline-none transition placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-70"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-extrabold text-blue-300 hover:text-blue-200 disabled:opacity-60"
                >
                  {showPassword ? "Cacher" : "Voir"}
                </button>
              </div>
            </div>
          </div>

          {mode === "login" && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={loading}
                className="text-sm font-extrabold text-blue-300 hover:text-blue-200 disabled:opacity-60"
              >
                Mot de passe oublié ?
              </button>
            </div>
          )}

          {err && (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {err}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {message}
            </div>
          )}

          <button
            type="button"
            onClick={mode === "login" ? handleLogin : handleSignup}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-950/50 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Chargement..." : mode === "login" ? "Se connecter" : "Créer mon compte client"}
          </button>

          <button
            type="button"
            onClick={() => {
              setErr(null);
              setMessage(null);
              setMode(mode === "login" ? "signup" : "login");
            }}
            disabled={loading}
            className="mt-4 w-full text-center text-sm font-extrabold text-blue-300 hover:text-blue-200 disabled:opacity-60"
          >
            {mode === "login" ? "Je n’ai pas encore de compte" : "J’ai déjà un compte"}
          </button>
        </div>
      </section>
    </main>
  );
}
