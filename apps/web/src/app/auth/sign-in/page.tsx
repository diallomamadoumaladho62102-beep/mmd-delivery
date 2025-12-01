"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function sendLink() {
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== "undefined"
          ? `${window.location.origin}/auth/whoami`
          : undefined,
      }
    });
    if (error) setErr(error.message); else setSent(true);
  }

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl mt-10 space-y-3">
      <h1 className="text-xl font-bold">Connexion par email</h1>
      <input
        type="email"
        className="w-full border rounded px-3 py-2"
        placeholder="you@example.com"
        value={email}
        onChange={e=>setEmail(e.target.value)}
      />
      <button onClick={sendLink} className="px-4 py-2 rounded bg-black text-white">
        Envoyer le lien magique
      </button>
      {sent && <p className="text-green-600">Lien envoyé. Vérifie ta boîte email.</p>}
      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}

