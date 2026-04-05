"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseBrowser";

type ViewState = "idle" | "loading" | "success" | "error";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [state, setState] = useState<ViewState>("idle");
  const [message, setMessage] = useState("");

  const trimmedEmail = useMemo(() => email.trim(), [email]);
  const emailIsValid = useMemo(() => isValidEmail(trimmedEmail), [trimmedEmail]);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      if (data.session) {
        window.location.href = "/dashboard";
        return;
      }

      setIsCheckingSession(false);
    };

    void loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        window.location.href = "/dashboard";
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const sendMagicLink = async () => {
    if (!trimmedEmail) {
      setState("error");
      setMessage("Entre ton adresse email.");
      return;
    }

    if (!emailIsValid) {
      setState("error");
      setMessage("Entre une adresse email valide.");
      return;
    }

    setState("loading");
    setMessage("");

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      setState("error");
      setMessage(`Erreur: ${error.message}`);
      return;
    }

    setState("success");
    setMessage("Lien magique envoyé. Vérifie ton email.");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50 px-4 py-10">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl md:grid-cols-2">
          <div className="flex flex-col justify-center bg-gray-900 px-8 py-10 text-white md:px-10">
            <Image
              src="/brand/mmd-logo.png"
              alt="MMD Delivery Logo"
              width={90}
              height={90}
              priority
              className="mb-6 h-auto w-auto"
            />

            <h1 className="text-3xl font-bold leading-tight md:text-4xl">
              Bienvenue sur MMD Delivery
            </h1>

            <p className="mt-4 text-sm text-gray-300 md:text-base">
              Une plateforme moderne pour les clients, les chauffeurs et les restaurants.
            </p>

            <div className="mt-8 space-y-3 text-sm text-gray-300">
              <div>Commande rapide</div>
              <div>Suivi en temps réel</div>
              <div>Gestion simple et sécurisée</div>
            </div>
          </div>

          <div className="flex items-center justify-center px-6 py-10 md:px-10">
            <div className="w-full max-w-md">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">Connexion</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Entre ton email pour recevoir un lien magique de connexion.
                </p>
              </div>

              {isCheckingSession ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  Vérification de la session...
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-700">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="ton.email@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && state !== "loading") {
                          void sendMagicLink();
                        }
                      }}
                      className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-gray-900"
                      disabled={state === "loading"}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={sendMagicLink}
                    disabled={state === "loading"}
                    className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {state === "loading" ? "Envoi en cours..." : "Envoyer le lien magique"}
                  </button>
                </div>
              )}

              {message ? (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                    state === "error"
                      ? "border border-red-200 bg-red-50 text-red-700"
                      : state === "success"
                      ? "border border-green-200 bg-green-50 text-green-700"
                      : "border border-gray-200 bg-gray-50 text-gray-700"
                  }`}
                >
                  {message}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}