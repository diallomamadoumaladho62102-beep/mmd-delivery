"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function SignInPanel() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  async function send() {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) alert(error.message); else setSent(true);
  }
  return (
    <div className="border rounded-xl p-4 space-y-2">
      <div className="text-sm font-medium">Se connecter</div>
      <input
        className="border rounded px-2 py-1 w-full"
        placeholder="ton@email.com"
        value={email}
        onChange={e=>setEmail(e.target.value)}
      />
      <button onClick={send} className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50">
        Envoyer le lien magique
      </button>
      {sent && <div className="text-xs text-green-700">Vérifie ta boîte mail ✉️</div>}
    </div>
  );
}

