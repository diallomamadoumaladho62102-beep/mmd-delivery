"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ROLE = "restaurant";
const RESET_PASSWORD_URL = "https://mmd-delivery.vercel.app/auth/reset-password";

type Mode = "login" | "signup";

function cleanEmail(value: string): string {
  return (value || "").trim().toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

async function ensureRestaurantAccount(params: {
  userId: string;
  email: string;
  createRestaurantProfileIfMissing?: boolean;
}) {
  const { userId, email, createRestaurantProfileIfMissing = true } = params;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      role: ROLE,
      email,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { data: existingRestaurantProfile, error: existingError } = await supabase
    .from("restaurant_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existingRestaurantProfile && createRestaurantProfileIfMissing) {
    const { error: restaurantError } = await supabase
      .from("restaurant_profiles")
      .insert({
        user_id: userId,
        email,
        status: "pending",
        offers_delivery: true,
        offers_pickup: true,
        offers_dine_in: false,
        is_accepting_orders: false,
      });

    if (restaurantError) {
      throw new Error(restaurantError.message);
    }
  }
}

export default function SignupRestaurantPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(
    () => (mode === "login" ? "Connexion Restaurant" : "Créer un compte Restaurant"),
    [mode]
  );

  const subtitle = useMemo(
    () =>
      mode === "login"
        ? "Connecte-toi avec ton compte restaurant."
        : "Crée ton compte restaurant puis complète ton profil.",
    [mode]
  );

  async function signIn() {
    if (loading) return;

    setErr(null);
    setMessage(null);

    const e = cleanEmail(email);
    const p = password.trim();

    if (!e) {
      setErr("Email obligatoire.");
      return;
    }

    if (!p) {
      setErr("Mot de passe obligatoire.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password: p,
      });

      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Session non créée. Réessaie.");

      const userId = data.user?.id;

      if (userId) {
        await ensureRestaurantAccount({
          userId,
          email: e,
          createRestaurantProfileIfMissing: false,
        });
      }

      setMessage("Connecté ✅");
      window.location.href = "/restaurant/profile";
    } catch (error: unknown) {
      setErr("Connexion impossible : " + getErrorMessage(error, "Erreur inconnue"));
    } finally {
      setLoading(false);
    }
  }

  async function signUp() {
    if (loading) return;

    setErr(null);
    setMessage(null);

    const e = cleanEmail(email);
    const p = password.trim();

    if (!e) {
      setErr("Email obligatoire.");
      return;
    }

    if (!p) {
      setErr("Mot de passe obligatoire.");
      return;
    }

    if (p.length < 6) {
      setErr("Mot de passe trop court. Minimum 6 caractères.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: e,
        password: p,
        options: {
          data: {
            role: ROLE,
          },
        },
      });

      if (error) throw new Error(error.message);

      const userId = data.user?.id;

      if (!userId) {
        throw new Error("Compte créé, mais impossible de récupérer l’utilisateur.");
      }

      await ensureRestaurantAccount({
        userId,
        email: e,
        createRestaurantProfileIfMissing: true,
      });

      if (!data.session) {
        setMessage("Compte créé ✅ Vérifie ton email puis connecte-toi.");
        setMode("login");
        return;
      }

      setMessage("Compte restaurant créé et connecté ✅");
      window.location.href = "/restaurant/profile";
    } catch (error: unknown) {
      setErr("Création du compte impossible : " + getErrorMessage(error, "Erreur inconnue"));
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    if (loading) return;

    setErr(null);
    setMessage(null);

    const e = cleanEmail(email);

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
      setMessage("Email envoyé ✅ Clique sur le lien reçu pour modifier ton mot de passe.");
    } catch (error: unknown) {
      setErr("Impossible d’envoyer l’email : " + getErrorMessage(error, "Erreur inconnue"));
    } finally {
      setLoading(false);
    }
  }

  const primaryLabel = mode === "login" ? "Se connecter" : "Créer un compte";

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-white">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl grid-cols-1 items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-extrabold text-slate-300">
            <span>🍽️</span>
            <span>MMD Restaurant Access</span>
          </div>

          <h1 className="mt-6 text-5xl font-black leading-tight tracking-tight xl:text-7xl">
            Grow your restaurant with MMD Delivery.
          </h1>

          <p className="mt-5 max-w-xl text-lg font-semibold leading-8 text-slate-400">
            Create your restaurant account, complete your profile, manage your menu,
            receive orders and prepare your business for payouts.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {[
              "Restaurant profile",
              "Menu ready",
              "Orders dashboard",
              "Stripe payouts",
            ].map((item) => (
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
            <p className="mb-3 text-xs font-black uppercase tracking-[0.25em] text-emerald-300">
              Restaurant account
            </p>
            <h2 className="text-3xl font-black tracking-tight md:text-5xl">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-400 md:text-base">
              {subtitle}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-950/80 p-2">
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setMessage(null);
                setMode("login");
              }}
              disabled={loading}
              className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                mode === "login"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setMessage(null);
                setMode("signup");
              }}
              disabled={loading}
              className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                mode === "signup"
                  ? "bg-sky-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Créer un compte
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-200">Email</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="restaurant@email.com"
                type="email"
                autoComplete="email"
                disabled={loading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-emerald-500 disabled:opacity-70"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-slate-200">Mot de passe</label>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mot de passe (min 6)"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={loading}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-semibold outline-none transition placeholder:text-slate-600 focus:border-emerald-500 disabled:opacity-70"
              />
            </div>
          </div>

          {mode === "login" && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={forgotPassword}
                disabled={loading}
                className="text-sm font-extrabold text-sky-300 hover:text-sky-200 disabled:opacity-60"
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
            onClick={mode === "login" ? signIn : signUp}
            disabled={loading}
            className={`mt-6 w-full rounded-2xl px-5 py-4 text-base font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-70 ${
              mode === "login"
                ? "bg-emerald-600 shadow-emerald-950/50 hover:bg-emerald-500"
                : "bg-sky-600 shadow-sky-950/50 hover:bg-sky-500"
            }`}
          >
            {loading ? "Chargement..." : primaryLabel}
          </button>

          <button
            type="button"
            onClick={() => {
              setErr(null);
              setMessage(null);
              setMode(mode === "login" ? "signup" : "login");
            }}
            disabled={loading}
            className="mt-4 w-full text-center text-sm font-extrabold text-sky-300 hover:text-sky-200 disabled:opacity-60"
          >
            {mode === "login"
              ? "Je n’ai pas de compte → Créer un compte"
              : "J’ai déjà un compte → Se connecter"}
          </button>

          <p className="mt-5 text-center text-xs font-bold leading-5 text-slate-500">
            Si la confirmation email est activée dans Supabase, confirme ton email avant de te reconnecter.
          </p>
        </div>
      </section>
    </main>
  );
}
