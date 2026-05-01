"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleUpdate = async () => {
    if (password.length < 6) {
      setMessage("Mot de passe trop court. Minimum 6 caractères.");
      return;
    }

    if (password !== confirm) {
      setMessage("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Mot de passe mis à jour avec succès ✅");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0B1220",
          border: "1px solid #111827",
          borderRadius: 18,
          padding: 24,
          color: "white",
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 10 }}>
          Nouveau mot de passe
        </h1>

        <p style={{ color: "#9CA3AF", marginBottom: 22 }}>
          Entre ton nouveau mot de passe MMD Delivery.
        </p>

        <input
          type="password"
          placeholder="Nouveau mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            marginBottom: 12,
            background: "#020617",
            border: "1px solid #1F2937",
            color: "white",
          }}
        />

        <input
          type="password"
          placeholder="Confirmer le mot de passe"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            marginBottom: 16,
            background: "#020617",
            border: "1px solid #1F2937",
            color: "white",
          }}
        />

        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            background: loading ? "#111827" : "#2563EB",
            color: "white",
            fontWeight: 900,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Chargement..." : "Mettre à jour"}
        </button>

        {message ? (
          <p style={{ marginTop: 14, color: "#CBD5E1", fontWeight: 700 }}>
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}