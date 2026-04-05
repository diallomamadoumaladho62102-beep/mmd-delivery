"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    setMsg(error ? `❌ ${error.message}` : "📩 Lien magique envoyé. Vérifie tes emails.");
  }

  return (
    <main className="p-6 max-w-sm mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Se connecter</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="border rounded px-3 py-2 w-full" type="email" required value={email}
               onChange={e=>setEmail(e.target.value)} placeholder="vous@email.com" />
        <button className="border rounded px-3 py-2 w-full" disabled={loading}>
          {loading ? "Envoi..." : "Envoyer le lien magique"}
        </button>
      </form>
      {msg && <p className="text-sm">{msg}</p>}
    </main>
  );
}

