type Role = {
  title: string;
  subtitle: string;
  href: string;
  color: string;
  icon: string;
  access: string;
};

const roles: Role[] = [
  {
    title: "Client",
    subtitle: "Order food, delivery and services in minutes.",
    href: "/signup/client",
    color: "#EF4444",
    icon: "🛍️",
    access: "Web + mobile",
  },
  {
    title: "Driver",
    subtitle: "Earn with rides, deliveries and opportunities.",
    href: "mmd://signup/driver",
    color: "#0EA5E9",
    icon: "🚗",
    access: "Mobile app only",
  },
  {
    title: "Restaurant",
    subtitle: "Receive orders and grow your business.",
    href: "/signup/restaurant",
    color: "#22C55E",
    icon: "🍽️",
    access: "Web + mobile",
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(239,68,68,0.24), transparent 34%), radial-gradient(circle at top right, rgba(14,165,233,0.22), transparent 36%), linear-gradient(180deg, #020617 0%, #050B18 100%)",
        color: "white",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 1180,
          margin: "0 auto",
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 36,
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.78)",
              border: "1px solid rgba(148,163,184,0.16)",
              color: "#CBD5E1",
              fontWeight: 800,
              marginBottom: 24,
            }}
          >
            <span>🚀</span>
            <span>Welcome to MMD Delivery</span>
          </div>

          <img
            src="/brand/mmd-logo.png"
            alt="MMD Delivery"
            style={{
              width: 112,
              height: 112,
              borderRadius: 30,
              objectFit: "cover",
              boxShadow: "0 18px 55px rgba(239,68,68,0.28)",
              marginBottom: 24,
            }}
          />

          <h1
            style={{
              fontSize: "clamp(48px, 7vw, 86px)",
              lineHeight: 0.95,
              letterSpacing: -3,
              margin: 0,
              fontWeight: 950,
            }}
          >
            MMD Delivery
          </h1>

          <p
            style={{
              marginTop: 20,
              fontSize: "clamp(22px, 3vw, 34px)",
              lineHeight: 1.25,
              color: "#F8FAFC",
              fontWeight: 850,
              maxWidth: 760,
            }}
          >
            We deliver with heart ❤️
            <br />
            Fast, simple and reliable.
          </p>

          <p
            style={{
              marginTop: 18,
              fontSize: 18,
              lineHeight: 1.7,
              color: "#94A3B8",
              maxWidth: 680,
              fontWeight: 650,
            }}
          >
            One platform for clients, drivers and restaurants. Order faster,
            earn smarter, and grow your business with a modern delivery
            experience.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 30,
            }}
          >
            {[
              "Real-time tracking",
              "Secure payments",
              "Driver earnings",
              "Restaurant tools",
            ].map((item) => (
              <span
                key={item}
                style={{
                  padding: "12px 14px",
                  borderRadius: 999,
                  background: "rgba(15,23,42,0.82)",
                  border: "1px solid rgba(148,163,184,0.14)",
                  color: "#CBD5E1",
                  fontSize: 14,
                  fontWeight: 850,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "rgba(15,23,42,0.76)",
            border: "1px solid rgba(148,163,184,0.16)",
            borderRadius: 36,
            padding: 26,
            boxShadow: "0 28px 80px rgba(0,0,0,0.42)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div
            style={{
              textAlign: "center",
              padding: "16px 8px 24px",
            }}
          >
            <p
              style={{
                margin: "0 0 12px",
                color: "#FCA5A5",
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Welcome — choose your access
            </p>

            <h2
              style={{
                fontSize: "clamp(34px, 5vw, 54px)",
                lineHeight: 1,
                margin: 0,
                fontWeight: 950,
                letterSpacing: -1.5,
              }}
            >
              Choose your mode
            </h2>

            <p
              style={{
                marginTop: 14,
                color: "#94A3B8",
                fontSize: 17,
                lineHeight: 1.55,
                fontWeight: 700,
              }}
            >
              Clients and restaurants can continue on web or mobile. Drivers
              continue in the MMD mobile app.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {roles.map((role) => (
              <a
                key={role.title}
                href={role.href}
                aria-label={`Continue as ${role.title}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "19px 18px",
                  borderRadius: 24,
                  background: `linear-gradient(135deg, ${role.color}, ${role.color}CC)`,
                  color: "white",
                  textDecoration: "none",
                  boxShadow: `0 16px 36px ${role.color}33`,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.18)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 28,
                    flexShrink: 0,
                  }}
                >
                  {role.icon}
                </span>

                <span style={{ flex: 1, textAlign: "left" }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: 28,
                        fontWeight: 950,
                        lineHeight: 1,
                      }}
                    >
                      {role.title}
                    </span>

                    <span
                      style={{
                        padding: "6px 9px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.2)",
                        fontSize: 11,
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {role.access}
                    </span>
                  </span>

                  <span
                    style={{
                      display: "block",
                      marginTop: 8,
                      fontSize: 14,
                      lineHeight: 1.4,
                      opacity: 0.92,
                      fontWeight: 700,
                    }}
                  >
                    {role.subtitle}
                  </span>
                </span>

                <span style={{ fontSize: 28, fontWeight: 900 }}>›</span>
              </a>
            ))}
          </div>

          <div
            style={{
              marginTop: 24,
              padding: 18,
              borderRadius: 22,
              background: "rgba(2,6,23,0.72)",
              border: "1px solid rgba(148,163,184,0.12)",
              color: "#94A3B8",
              fontSize: 13,
              lineHeight: 1.6,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            MMD Delivery connects people, work and local businesses with a
            premium mobile-first delivery experience.
          </div>
        </div>
      </section>
    </main>
  );
}