"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import {
  isEmailVerificationRequired,
  isUserEmailVerified,
} from "@/lib/authValidation";

export default function SignInPassword() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(error.message);
      return;
    }
    if (
      isEmailVerificationRequired() &&
      !isUserEmailVerified(data.user)
    ) {
      await supabase.auth.signOut();
      setErr("Please verify your email before signing in.");
      return;
    }
    location.href = "/auth/whoami";
  }

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl mt-10 space-y-4">
      <h1 className="text-xl font-bold">Connexion (email + mot de passe)</h1>
      <input
        className="w-full border rounded px-3 py-2"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="relative">
        <input
          className="w-full border rounded px-3 py-2 pr-20"
          type={showPassword ? "text" : "password"}
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-blue-600"
        >
          {showPassword ? "Cacher" : "Voir"}
        </button>
      </div>
      <button
        onClick={submit}
        className="w-full px-4 py-2 rounded bg-black text-white"
      >
        Se connecter
      </button>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      <div className="text-sm text-gray-600">
        Pas de compte ?{" "}
        <a className="underline" href="/auth/sign-up">
          Créer un compte
        </a>
      </div>
    </div>
  );
}
