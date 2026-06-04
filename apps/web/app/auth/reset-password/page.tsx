"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

function getUrlParams(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const params: Record<string, string> = {};
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : "";
  const query = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : "";

  const raw = [hash, query].filter(Boolean).join("&");

  raw.split("&").forEach((part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  });

  return params;
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [message, setMessage] = useState("");

  const prepareRecoverySession = useCallback(async () => {
    try {
      const params = getUrlParams();
      const accessToken = params.access_token;
      const refreshToken = params.refresh_token;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          setMessage("Lien invalide ou expiré. Demande un nouveau lien par email.");
          return;
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        setMessage(
          "Session de réinitialisation introuvable. Ouvre le lien depuis l’email récent."
        );
      }
    } catch {
      setMessage("Impossible de préparer la réinitialisation.");
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    void prepareRecoverySession();
  }, [prepareRecoverySession]);

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

        {checkingSession ? (
          <p style={{ color: "#9CA3AF", marginBottom: 16 }}>
            Vérification du lien de réinitialisation…
          </p>
        ) : null}

        <div style={{ position: "relative", marginBottom: 12 }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Nouveau mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading || checkingSession}
            style={{
              width: "100%",
              padding: 14,
              paddingRight: 72,
              borderRadius: 12,
              background: "#020617",
              border: "1px solid #1F2937",
              color: "white",
            }}
          />
          <button
            type="button"
            disabled={loading || checkingSession}
            onClick={() => setShowPassword((value) => !value)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "#9CA3AF",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {showPassword ? "Masquer" : "Afficher"}
          </button>
        </div>

        <div style={{ position: "relative", marginBottom: 12 }}>
          <input
            type={showConfirmPassword ? "text" : "password"}
            placeholder="Confirmer le mot de passe"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={loading || checkingSession}
            style={{
              width: "100%",
              padding: 14,
              paddingRight: 72,
              borderRadius: 12,
              background: "#020617",
              border: "1px solid #1F2937",
              color: "white",
            }}
          />
          <button
            type="button"
            disabled={loading || checkingSession}
            onClick={() => setShowConfirmPassword((value) => !value)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "#9CA3AF",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {showConfirmPassword ? "Masquer" : "Afficher"}
          </button>
        </div>

        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading || checkingSession}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 12,
            background: "#10B981",
            border: "none",
            color: "white",
            fontWeight: 800,
            cursor: loading || checkingSession ? "not-allowed" : "pointer",
            opacity: loading || checkingSession ? 0.6 : 1,
          }}
        >
          {loading ? "Mise à jour…" : "Mettre à jour"}
        </button>

        {message ? (
          <p style={{ marginTop: 16, color: "#D1D5DB", fontSize: 14 }}>{message}</p>
        ) : null}
      </section>
    </main>
  );
}
