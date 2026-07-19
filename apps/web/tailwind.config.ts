import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mmd: {
          bg: "#020617",
          elevated: "#0B1220",
          surface: "#111827",
          border: "#1F2937",
          text: "#F8FAFC",
          muted: "#94A3B8",
          accent: "#A78BFA",
          "accent-strong": "#7C3AED",
        },
      },
      borderRadius: {
        mmd: "14px",
      },
      minHeight: {
        tap: "44px",
      },
      screens: {
        xs: "380px",
      },
    },
  },
  plugins: [],
};

export default config;
