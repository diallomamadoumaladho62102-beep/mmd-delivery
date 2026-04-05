"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function SignUp() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [err,setErr]=useState<string|null>(null); const [ok,setOk]=useState(false);
  const router=useRouter();

  async function submit(){
    setErr(null); setOk(false);
    if(!email || !password){ setErr("Email et mot de passe requis."); return; }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if(error){ setErr(error.message); return; }
    // si confirm email désactivé, l'utilisateur est déjà connecté
    const u = (await supabase.auth.getUser()).data.user;
    if(u){ setOk(true); setTimeout(()=>router.push("/auth/whoami"), 600); }
    else { setOk(true); }
  }

  return (
    <div className="max-w-md mx-auto p-6 border rounded-xl mt-10 space-y-4">
      <h1 className="text-xl font-bold">Créer un compte</h1>
      <input className="w-full border rounded px-3 py-2" type="email" placeholder="you@example.com"
             value={email} onChange={e=>setEmail(e.target.value)} />
      <input className="w-full border rounded px-3 py-2" type="password" placeholder="Mot de passe (ex: Mmd#2025Driver!)"
             value={password} onChange={e=>setPassword(e.target.value)} />
      <button onClick={submit} className="w-full px-4 py-2 rounded bg-black text-white">Créer le compte</button>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {ok && <div className="text-green-700 text-sm">Compte créé. Redirection…</div>}
      <div className="text-sm text-gray-600">
        Déjà un compte ? <a className="underline" href="/auth/sign-in-password">Se connecter</a>
      </div>
    </div>
  );
}

