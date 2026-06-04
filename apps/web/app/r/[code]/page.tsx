"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const APP_STORE_URL = "https://apps.apple.com";
const PLAY_STORE_URL = "https://play.google.com/store";

export default function ReferralPage() {
  const params = useParams();

  const referralCode = useMemo(() => {
    return String(params?.code ?? "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .toUpperCase();
  }, [params]);

  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (!referralCode) return;

    const appUrl = `mmddelivery://r/${referralCode}`;
    const legacyAppUrl = `mmd://r/${referralCode}`;

    const timeout = setTimeout(() => {
      setShowFallback(true);
    }, 1800);

    try {
      window.location.href = appUrl;
      setTimeout(() => {
        try {
          window.location.href = legacyAppUrl;
        } catch {
          // ignore legacy fallback errors
        }
      }, 600);
    } catch (e) {
      console.log("Deep link error", e);
      setShowFallback(true);
    }

    return () => clearTimeout(timeout);
  }, [referralCode]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #172554 0%, #020617 55%)",
        color: "#F8FAFC",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(15,23,42,0.78)",
          border: "1px solid rgba(148,163,184,0.14)",
          borderRadius: 28,
          padding: 28,
          backdropFilter: "blur(18px)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.45)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 78,
            height: 78,
            margin: "0 auto 18px",
            borderRadius: 24,
            background:
              "linear-gradient(135deg, rgba(139,92,246,0.95), rgba(59,130,246,0.95))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 900,
            boxShadow: "0 12px 30px rgba(59,130,246,0.25)",
          }}
        >
          M
        </div>

        <h1
          style={{
            fontSize: 34,
            fontWeight: 900,
            margin: 0,
            letterSpacing: -1,
          }}
        >
          MMD Delivery
        </h1>

        <p
          style={{
            marginTop: 12,
            color: "#CBD5E1",
            fontSize: 16,
            lineHeight: 1.6,
          }}
        >
          Opening the application…
        </p>

        <div
          style={{
            marginTop: 22,
            padding: "14px 18px",
            borderRadius: 18,
            background: "rgba(2,6,23,0.72)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#94A3B8",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Referral Code
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 900,
              color: "#FFFFFF",
              letterSpacing: 1,
              wordBreak: "break-word",
            }}
          >
            {referralCode || "—"}
          </div>
        </div>

        {showFallback ? (
          <>
            <p
              style={{
                marginTop: 24,
                color: "#94A3B8",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              If the app did not open automatically, download MMD Delivery below.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginTop: 18,
              }}
            >
              <a
                href={APP_STORE_URL}
                style={{
                  textDecoration: "none",
                }}
              >
                <button
                  style={{
                    width: "100%",
                    border: 0,
                    borderRadius: 16,
                    padding: "16px 18px",
                    background:
                      "linear-gradient(135deg, rgba(139,92,246,0.95), rgba(59,130,246,0.95))",
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Download on the App Store
                </button>
              </a>

              <a
                href={PLAY_STORE_URL}
                style={{
                  textDecoration: "none",
                }}
              >
                <button
                  style={{
                    width: "100%",
                    borderRadius: 16,
                    padding: "16px 18px",
                    background: "rgba(15,23,42,0.92)",
                    border: "1px solid rgba(148,163,184,0.14)",
                    color: "#FFFFFF",
                    fontSize: 15,
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Get it on Google Play
                </button>
              </a>
            </div>
          </>
        ) : (
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "#60A5FA",
              fontWeight: 800,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "#60A5FA",
                animation: "pulse 1s infinite",
              }}
            />
            Connecting to MMD Delivery...
          </div>
        )}

        <p
          style={{
            marginTop: 28,
            fontSize: 12,
            color: "#64748B",
            fontWeight: 700,
          }}
        >
          © {new Date().getFullYear()} MMD Delivery
        </p>
      </div>
    </main>
  );
}