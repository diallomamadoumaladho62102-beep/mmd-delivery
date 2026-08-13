/** Figma Business App Desktop 1280 — visual tokens only. */

export const BIZ_BLUE = "#0033CC";
export const BIZ_BLUE_DEEP = "#0044DD";
export const BIZ_GOLD = "#D4AF37";
export const BIZ_GOLD_SOFT = "#FBBF24";
export const BIZ_GOLD_ACTIVE = "#FCD34D";
export const BIZ_GREEN = "#22C55E";
export const BIZ_RED = "#EF4444";
export const BIZ_REJECT = "#7F1D1D";
export const BIZ_ACTIVE_NAV = "#78350F";
export const BIZ_GLASS = "rgba(255,255,255,0.08)";
export const BIZ_GLASS_BORDER = "rgba(255,255,255,0.12)";
export const BIZ_GLASS_BORDER_STRONG = "rgba(255,255,255,0.15)";
export const BIZ_MUTED = "rgba(255,255,255,0.7)";
export const BIZ_MUTED_SOFT = "rgba(255,255,255,0.6)";
export const BIZ_LOGO = "/brand/mmd-logo-ui.png";

export const bizShell =
  "min-h-screen flex flex-col bg-[#0033CC] text-white font-[family-name:var(--font-sora)]";

export const bizGlass =
  "backdrop-blur-[12px] bg-white/[0.08] border border-white/[0.12]";

export const bizGlassStrong =
  "backdrop-blur-[14px] bg-[#0044DD] border border-white/80";

export const bizCard =
  "backdrop-blur-[12px] bg-white/[0.08] border border-white/[0.12] rounded-3xl shadow-[0px_14px_30px_0px_rgba(0,0,0,0.15)]";

export const bizNavIdle =
  "rounded-xl px-3.5 py-2.5 text-[13px] sm:text-sm font-bold text-white/70 border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition";

export const bizNavActive =
  "rounded-xl px-3.5 py-2.5 text-[13px] sm:text-sm font-extrabold text-[#FCD34D] border border-[#78350F] bg-[#78350F]";

export function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format((Number(cents) || 0) / 100);
}
