"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";
import { validatePassword } from "@/lib/authValidation";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const router = useRouter();

  async function submit() {
    setErr(null);
    setOk(false);
    if (!email || !password) {
      setErr("Email et mot de passe requis.");
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setErr(passwordError);
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setErr(error.message);
      return;
    }
    const u = (await supabase.auth.getUser()).data.user;
    if (u) {
      setOk(true);
      setTimeout(() => router.push("/auth/whoami"), 600);
    } else {
      setOk(true);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl mt-10 space-y-4">
      <h1 className="text-xl font-bold">Créer un compte</h1>
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
        Créer le compte
      </button>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {ok && <div className="text-green-700 text-sm">Compte créé. Redirection…</div>}
      <div className="text-sm text-gray-600">
        Déjà un compte ?{" "}
        <a className="underline" href="/auth/sign-in-password">
          Se connecter
        </a>
      </div>
    </div>
  );
}
