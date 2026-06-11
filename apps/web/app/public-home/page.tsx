"use client";

import PublicHomeContent from "@/components/PublicHomeContent";

export default function PublicHomePage() {
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
        <PublicHomeContent />
      </section>
    </main>
  );
}
