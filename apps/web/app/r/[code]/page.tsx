"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

export default function ReferralPage() {
  const params = useParams();
  const code = String(params?.code ?? "");

  useEffect(() => {
    if (!code) return;

    const appUrl = `mmd://r/${code}`;

    window.location.href = appUrl;
  }, [code]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#020617",
        color: "white",
        fontFamily: "sans-serif",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ fontSize: 32, fontWeight: 700 }}>
          MMD Delivery
        </h1>

        <p style={{ marginTop: 12, opacity: 0.8 }}>
          Ouverture de l’application…
        </p>

        <p style={{ marginTop: 20, fontSize: 14, opacity: 0.6 }}>
          Referral code: {code}
        </p>
      </div>
    </main>
  );
}
