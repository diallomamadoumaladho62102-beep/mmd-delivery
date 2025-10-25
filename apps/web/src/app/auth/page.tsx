"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseBrowser";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [info, setInfo] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const sendMagicLink = async () => {
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({ email });
    setInfo(error ? "Erreur: " + error.message : "Lien envoyé ! Vérifie ton email.");
  };

  const joinTestOrder = async () => {
    if (!userId) { setInfo("Connecte-toi d'abord."); return; }
    const { error } = await supabase.from("order_members").insert({
      order_id: "test-order-1",
      user_id: userId,
      role: "client"
    });
    setInfo(error ? "Erreur: " + error.message : "Accès au chat activé pour test-order-1 ✅");
  };

  const sendTestMessage = async () => {
    if (!userId) { setInfo("Connecte-toi d'abord."); return; }
    const { error } = await supabase.from("order_messages").insert({
      order_id: "test-order-1",
      user_id: userId,
      message: "Hello depuis /auth 🚀"
    });
    setInfo(error ? "Erreur: " + error.message : "Message envoyé ✅");
  };

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Connexion</h1>

      {!userId && (
        <div className="space-y-2">
          <input
            type="email"
            placeholder="ton@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <button onClick={sendMagicLink} className="border rounded px-4 py-2">Recevoir un lien magique</button>
        </div>
      )}

      {userId && (
        <div className="space-y-2">
          <div className="text-sm opacity-70">Connecté: <span className="font-mono">{userId}</span></div>
          <button onClick={joinTestOrder} className="border rounded px-4 py-2">Activer l'accès au chat test-order-1</button>
          <button onClick={sendTestMessage} className="border rounded px-4 py-2">Envoyer un message de test</button>
          <div className="text-sm">Va ensuite sur <code>/orders/test-order-1/chat</code> et rafraîchis.</div>
        </div>
      )}

      {info && <div className="text-sm">{info}</div>}
    </div>
  );
}
