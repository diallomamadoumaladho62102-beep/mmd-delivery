/**
 * Corporate site theme tokens — navy + orange/rose.
 * Prefer Tailwind classes; CSS vars for surfaces that need theming.
 */

export const siteTheme = {
  brandName: "MMD Delivery",
  logoSrc: "/brand/mmd-logo.png",
  heroImageSrc: "/brand/hero/hero-rider.png",
  fontFamily: '"Sora", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  colors: {
    navy: "#020617",
    navyElevated: "#0b1220",
    navySurface: "#111827",
    border: "rgba(255,255,255,0.10)",
    text: "#f8fafc",
    muted: "#94a3b8",
    orange: "#fb923c",
    rose: "#f43f5e",
    amber: "#f59e0b",
  },
} as const;

/** Root class for corporate pages (scopes CSS vars + font). */
export const siteRootClass =
  "site-root min-h-screen text-slate-50 antialiased " +
  "bg-[radial-gradient(ellipse_at_top_left,rgba(251,146,60,0.18),transparent_42%)," +
  "radial-gradient(ellipse_at_top_right,rgba(244,63,94,0.12),transparent_40%)," +
  "linear-gradient(180deg,#020617_0%,#030712_55%,#020617_100%)]";

export const siteContainerClass = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export const siteSectionClass = "py-14 sm:py-20";

export const siteHeadingClass =
  "text-3xl font-semibold tracking-tight text-white sm:text-4xl";

export const siteSubheadingClass = "mt-3 max-w-2xl text-base text-slate-300 sm:text-lg";

export const siteCardClass =
  "rounded-2xl border border-white/10 bg-slate-900/60 p-6 backdrop-blur-sm " +
  "transition-[border-color,transform] duration-300 motion-safe:hover:-translate-y-0.5 " +
  "motion-safe:hover:border-orange-400/30 motion-reduce:transition-none";

export const sitePrimaryBtnClass =
  "inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold " +
  "text-white shadow-lg shadow-rose-500/20 " +
  "bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 " +
  "transition-opacity duration-200 hover:opacity-95 focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-orange-400";

export const siteSecondaryBtnClass =
  "inline-flex items-center justify-center rounded-xl border border-white/15 " +
  "bg-slate-900/70 px-5 py-3 text-sm font-semibold text-white " +
  "transition-colors duration-200 hover:border-orange-400/40 hover:bg-slate-800/80 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-orange-400";

export const siteChipClass =
  "inline-flex items-center rounded-lg border border-orange-400/25 " +
  "bg-orange-500/10 px-3 py-1.5 text-sm font-medium text-orange-100";

export const siteLinkClass =
  "text-orange-300 underline-offset-4 transition-colors hover:text-orange-200 hover:underline";

export const siteGradientTextClass =
  "bg-gradient-to-br from-amber-300 via-orange-400 to-rose-500 bg-clip-text text-transparent";

/** Inline style block for CSS variables (optional inject in SiteShell). */
export const siteCssVars = `
.site-root {
  --site-navy: #020617;
  --site-elevated: #0b1220;
  --site-surface: #111827;
  --site-border: rgba(255, 255, 255, 0.1);
  --site-text: #f8fafc;
  --site-muted: #94a3b8;
  --site-orange: #fb923c;
  --site-rose: #f43f5e;
  --site-amber: #f59e0b;
  font-family: ${siteTheme.fontFamily};
}
@media (prefers-reduced-motion: reduce) {
  .site-root *,
  .site-root *::before,
  .site-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();
