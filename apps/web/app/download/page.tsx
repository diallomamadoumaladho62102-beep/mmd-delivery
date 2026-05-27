const IOS_URL = "https://www.mmddelivery.com";
const ANDROID_URL = "https://www.mmddelivery.com";
const FALLBACK_URL = "https://www.mmddelivery.com";

export default function DownloadPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(249,115,22,0.24), transparent 32%), radial-gradient(circle at top right, rgba(244,63,94,0.18), transparent 34%), linear-gradient(180deg,#020617 0%,#030712 100%)",
        color: "white",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24,
      }}
    >
      <section style={{ maxWidth: 980, margin: "0 auto", paddingTop: 40 }}>
        <a
          href="/"
          style={{
            color: "#FDBA74",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          ← Back to MMD Delivery
        </a>

        <div
          style={{
            marginTop: 34,
            borderRadius: 36,
            padding: 28,
            background: "rgba(15,23,42,0.78)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 30px 90px rgba(0,0,0,0.45)",
            textAlign: "center",
          }}
        >
          <img
            src="/brand/mmd-logo.png"
            alt="MMD Delivery"
            style={{
              width: 118,
              height: 118,
              borderRadius: 30,
              objectFit: "cover",
              boxShadow: "0 16px 50px rgba(249,115,22,0.35)",
            }}
          />

          <h1
            style={{
              margin: "26px 0 0",
              fontSize: "clamp(44px,7vw,76px)",
              lineHeight: 1,
              fontWeight: 950,
              letterSpacing: -2,
            }}
          >
            Download MMD Delivery
          </h1>

          <p
            style={{
              margin: "18px auto 0",
              maxWidth: 680,
              color: "#CBD5E1",
              fontSize: 20,
              lineHeight: 1.7,
              fontWeight: 650,
            }}
          >
            Order, track, drive, deliver and manage your restaurant from one
            powerful platform.
          </p>

          <div
            style={{
              marginTop: 34,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 18,
            }}
          >
            <a
              href={IOS_URL}
              style={{
                minWidth: 220,
                padding: "18px 24px",
                borderRadius: 22,
                background: "linear-gradient(135deg,#111827,#020617)",
                border: "1px solid rgba(255,255,255,0.16)",
                color: "white",
                textDecoration: "none",
                fontSize: 20,
                fontWeight: 900,
              }}
            >
               App Store
            </a>

            <a
              href={ANDROID_URL}
              style={{
                minWidth: 220,
                padding: "18px 24px",
                borderRadius: 22,
                background: "linear-gradient(135deg,#F59E0B,#F43F5E)",
                color: "white",
                textDecoration: "none",
                fontSize: 20,
                fontWeight: 900,
              }}
            >
              ▶ Google Play
            </a>
          </div>

          <div
            style={{
              marginTop: 34,
              padding: 22,
              borderRadius: 28,
              background: "rgba(2,6,23,0.65)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <p style={{ margin: 0, color: "#94A3B8", fontWeight: 700 }}>
              Testing mode: App Store and Google Play links will be updated
              when the production apps are approved.
            </p>

            <a
              href={FALLBACK_URL}
              style={{
                display: "inline-block",
                marginTop: 16,
                color: "#FDBA74",
                fontWeight: 900,
                textDecoration: "none",
              }}
            >
              Continue to website →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}