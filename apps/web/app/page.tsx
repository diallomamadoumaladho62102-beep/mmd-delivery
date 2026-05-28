type Feature = {
  title: string;
  description: string;
  icon: string;
};

const features: Feature[] = [
  {
    title: "Real-time Tracking",
    description: "Track every order and delivery live.",
    icon: "📍",
  },
  {
    title: "Secure Payments",
    description: "Fast, safe and encrypted transactions.",
    icon: "🔒",
  },
  {
    title: "Driver Earnings",
    description: "More deliveries, more opportunities.",
    icon: "💰",
  },
  {
    title: "Restaurant Tools",
    description: "Powerful business and order management.",
    icon: "🏪",
  },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(255,98,0,0.22), transparent 30%), radial-gradient(circle at top right, rgba(255,0,85,0.16), transparent 32%), linear-gradient(180deg, #020617 0%, #030712 100%)",
        color: "white",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 1380,
          margin: "0 auto",
          padding: "28px 22px 90px",
        }}
      >
        {/* TOP BAR */}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
            marginBottom: 42,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <img
              src="/brand/mmd-logo.png"
              alt="MMD Delivery"
              style={{
                width: 86,
                height: 86,
                borderRadius: 24,
                objectFit: "cover",
                boxShadow: "0 12px 40px rgba(255,98,0,0.45)",
              }}
            />

            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 42,
                  fontWeight: 950,
                  lineHeight: 1,
                }}
              >
                MMD Delivery
              </h1>

              <p
                style={{
                  marginTop: 8,
                  color: "#CBD5E1",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                We deliver with heart ❤️
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 18,
              alignItems: "center",
            }}
          >
            <a
              href="tel:+19294924563"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                textDecoration: "none",
                color: "white",
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, rgba(255,140,0,0.25), rgba(255,98,0,0.1))",
                  border: "1px solid rgba(255,153,0,0.28)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                }}
              >
                📞
              </div>

              <div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 900,
                    color: "#FDBA74",
                  }}
                >
                  (929) 492-4563
                </div>

                <div
                  style={{
                    color: "#CBD5E1",
                    fontWeight: 700,
                  }}
                >
                  Support 24/7
                </div>
              </div>
            </a>

            <div
              style={{
                width: 1,
                height: 58,
                background: "rgba(255,255,255,0.12)",
              }}
            />

            <a
              href="mailto:support@mmddelivery.com"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                textDecoration: "none",
                color: "white",
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, rgba(255,140,0,0.25), rgba(255,98,0,0.1))",
                  border: "1px solid rgba(255,153,0,0.28)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                }}
              >
                ✉️
              </div>

              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 850,
                  }}
                >
                  support@mmddelivery.com
                </div>

                <div
                  style={{
                    color: "#CBD5E1",
                    fontWeight: 700,
                  }}
                >
                  We’re here to help!
                </div>
              </div>
            </a>
          </div>
        </div>

        {/* HERO */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 42,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 18px",
                borderRadius: 999,
                background: "rgba(15,23,42,0.78)",
                border: "1px solid rgba(255,153,0,0.2)",
                marginBottom: 28,
                fontWeight: 800,
                color: "#F8FAFC",
              }}
            >
              🚀 Welcome to MMD Delivery
            </div>

            <h2
              style={{
                fontSize: "clamp(64px, 10vw, 130px)",
                lineHeight: 0.9,
                margin: 0,
                fontWeight: 950,
                letterSpacing: -5,
              }}
            >
              <span style={{ color: "white" }}>MMD</span>
              <br />

              <span
                style={{
                  background:
                    "linear-gradient(135deg,#FDBA74 0%,#FB923C 35%,#F43F5E 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Delivery
              </span>
            </h2>

            <p
              style={{
                marginTop: 28,
                fontSize: "clamp(24px, 4vw, 42px)",
                lineHeight: 1.2,
                fontWeight: 900,
                color: "#F8FAFC",
              }}
            >
              We deliver with heart ❤️
              <br />
              Fast, simple and reliable.
            </p>

            <p
              style={{
                marginTop: 24,
                maxWidth: 720,
                color: "#CBD5E1",
                lineHeight: 1.8,
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              One premium platform for clients, drivers and restaurants.
              Order faster, earn smarter and grow your business with a
              powerful delivery experience.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 18,
                marginTop: 36,
              }}
            >
              <a
                href="/download"
                style={{
                  padding: "18px 34px",
                  borderRadius: 22,
                  background:
                    "linear-gradient(135deg,#F59E0B,#F43F5E)",
                  color: "white",
                  textDecoration: "none",
                  fontWeight: 900,
                  fontSize: 22,
                  boxShadow: "0 18px 50px rgba(244,63,94,0.28)",
                }}
              >
                📱 Get the App
              </a>

              <a
                href="tel:+19294924563"
                style={{
                  padding: "18px 34px",
                  borderRadius: 22,
                  background: "rgba(15,23,42,0.82)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "white",
                  textDecoration: "none",
                  fontWeight: 850,
                  fontSize: 22,
                }}
              >
                📞 Contact Support
              </a>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 28,
                marginTop: 54,
              }}
            >
              {[
                ["10K+", "Happy Clients"],
                ["50K+", "Deliveries"],
                ["2K+", "Restaurants"],
                ["4.8", "User Rating"],
              ].map(([value, label]) => (
                <div key={label}>
                  <div
                    style={{
                      fontSize: 42,
                      fontWeight: 950,
                      color: "#F8FAFC",
                    }}
                  >
                    {value}
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      color: "#CBD5E1",
                      fontWeight: 700,
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* HERO IMAGE */}

          <div
            style={{
              position: "relative",
            }}
          >
            <img
              src="/brand/hero/hero-rider.png"
              alt="MMD Delivery Rider"
              style={{
                width: "100%",
                borderRadius: 36,
                objectFit: "cover",
                boxShadow: "0 40px 120px rgba(0,0,0,0.5)",
              }}
            />
          </div>
        </div>

        {/* FEATURES */}

        <div
          style={{
            marginTop: 70,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
            gap: 24,
          }}
        >
          {features.map((feature) => (
            <div
              key={feature.title}
              style={{
                padding: 32,
                borderRadius: 30,
                background: "rgba(15,23,42,0.75)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(14px)",
              }}
            >
              <div
                style={{
                  fontSize: 56,
                }}
              >
                {feature.icon}
              </div>

              <h3
                style={{
                  marginTop: 20,
                  marginBottom: 10,
                  fontSize: 34,
                  lineHeight: 1.1,
                  fontWeight: 900,
                }}
              >
                {feature.title}
              </h3>

              <p
                style={{
                  color: "#CBD5E1",
                  fontSize: 18,
                  lineHeight: 1.7,
                  fontWeight: 600,
                }}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* DOWNLOAD SECTION */}

        <div
          style={{
            marginTop: 70,
            padding: 34,
            borderRadius: 36,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(2,6,23,0.95))",
            border: "1px solid rgba(255,153,0,0.18)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
            gap: 40,
            alignItems: "center",
          }}
        >
          <div>
            <h3
              style={{
                fontSize: "clamp(40px,6vw,64px)",
                lineHeight: 1,
                margin: 0,
                fontWeight: 950,
              }}
            >
              Everything you need,
              <br />

              <span
                style={{
                  background:
                    "linear-gradient(135deg,#FDBA74,#F43F5E)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                in one powerful app.
              </span>
            </h3>

            <p
              style={{
                marginTop: 22,
                color: "#CBD5E1",
                fontSize: 22,
                lineHeight: 1.8,
                fontWeight: 600,
              }}
            >
              Order, track, manage and grow your business with MMD Delivery.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 24,
            }}
          >
            {["App Store", "Google Play"].map((store) => (
              <div
                key={store}
                style={{
                  padding: 20,
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  textAlign: "center",
                  minWidth: 190,
                }}
              >
                <img
                  src="/brand/mmd-logo.png"
                  alt={`${store} QR`}
                  style={{
                    width: 140,
                    height: 140,
                    borderRadius: 14,
                    background: "white",
                    padding: 8,
                  }}
                />

                <div
                  style={{
                    marginTop: 14,
                    fontSize: 20,
                    fontWeight: 850,
                  }}
                >
                  {store}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FOOTER */}

        <footer
          style={{
            marginTop: 50,
            paddingTop: 34,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 20,
            color: "#94A3B8",
            fontWeight: 700,
          }}
        >
          <div>⚡ Fast Delivery</div>
          <div>❤️ We Deliver With Heart</div>
          <div>🎧 24/7 Support</div>
        </footer>
      </section>
    </main>
  );
}