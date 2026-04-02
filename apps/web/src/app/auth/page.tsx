"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseBrowser";

type ViewState = "idle" | "loading" | "success" | "error";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [state, setState] = useState<ViewState>("idle");
  const [message, setMessage] = useState("");

  const trimmedEmail = useMemo(() => email.trim(), [email]);
  const emailIsValid = useMemo(() => isValidEmail(trimmedEmail), [trimmedEmail]);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          if (isMounted) {
            setState("error");
            setMessage("Impossible de vérifier la session. Réessaie.");
          }
          return;
        }

        if (isMounted) {
          setIsAuthenticated(!!data.session);
        }
      } catch {
        if (isMounted) {
          setState("error");
          setMessage("Une erreur est survenue pendant la vérification de la session.");
        }
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => {
      isMounted = false;
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

    try {
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
        setMessage(error.message || "Impossible d’envoyer le lien magique.");
        return;
      }

      setState("success");
      setMessage("Lien magique envoyé. Vérifie ton email.");
    } catch {
      setState("error");
      setMessage("Une erreur inattendue est survenue. Réessaie.");
    }
  };

  const signOut = async () => {
    try {
      setState("loading");
      setMessage("");

      const { error } = await supabase.auth.signOut();

      if (error) {
        setState("error");
        setMessage(error.message || "Impossible de se déconnecter.");
        return;
      }

      setIsAuthenticated(false);
      setState("success");
      setMessage("Déconnexion réussie.");
    } catch {
      setState("error");
      setMessage("Une erreur est survenue pendant la déconnexion.");
    }
  };

  return (
    <main className="min-h-screen bg-white px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Connexion</h1>
          <p className="mt-2 text-sm text-gray-600">
            Entre ton email pour recevoir un lien magique de connexion MMD Delivery.
          </p>
        </div>

        {isCheckingSession ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            Vérification de la session...
          </div>
        ) : !isAuthenticated ? (
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
                className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm outline-none transition focus:border-gray-900"
                disabled={state === "loading"}
              />
            </div>

            <button
              type="button"
              onClick={sendMagicLink}
              disabled={state === "loading"}
              className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" ? "Envoi en cours..." : "Envoyer le lien magique"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Tu es connecté.
            </div>

            <button
              type="button"
              onClick={signOut}
              disabled={state === "loading"}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" ? "Patiente..." : "Se déconnecter"}
            </button>
          </div>
        )}

        {message ? (
          <div
            className={`mt-4 rounded-xl px-4 py-3 text-sm ${
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
    </main>
  );
}