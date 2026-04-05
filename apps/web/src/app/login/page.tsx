"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!email.trim()) {
      setErr("Merci de saisir un email.");
      return;
    }

    setLoading(true);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        setErr(error.message);
      } else {
        setSent(true);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Connexion</h1>
      <p className="text-sm text-gray-600">
        Entre ton email pour recevoir un lien magique de connexion MMD Delivery.
      </p>

      {sent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Le lien de connexion a été envoyé à <strong>{email}</strong>.{" "}
          Vérifie ta boîte mail et clique sur le lien pour te connecter.
        </div>
      ) : (
        <form className="space-y-3" onSubmit={handleLogin}>
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="ton.email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Envoi en cours…" : "Envoyer le lien magique"}
          </button>
        </form>
      )}
    </div>
  );
}
