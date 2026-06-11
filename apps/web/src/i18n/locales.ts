export type WebLocale = "en" | "fr";

export const WEB_LOCALES: WebLocale[] = ["en", "fr"];

export const WEB_MESSAGES: Record<WebLocale, Record<string, string>> = {
  en: {
    "app.title": "MMD Delivery",
    "app.description": "Delivery, taxi, restaurants and marketplace",
    "nav.home": "Home",
    "nav.login": "Log in",
    "nav.signup": "Sign up",
    "public.hero": "Your local delivery platform",
  },
  fr: {
    "app.title": "MMD Delivery",
    "app.description": "Livraison, taxi, restaurants et marketplace",
    "nav.home": "Accueil",
    "nav.login": "Connexion",
    "nav.signup": "Inscription",
    "public.hero": "Votre plateforme de livraison locale",
  },
};

/** Admin/staff pages remain EN/FR only by policy (staff bilingual). */
export const ADMIN_I18N_NOTE =
  "Admin UI: English + French supported; other locales use English fallback.";

export function normalizeWebLocale(raw: string | null | undefined): WebLocale {
  const v = String(raw ?? "en").trim().toLowerCase();
  return v.startsWith("fr") ? "fr" : "en";
}

export function webT(key: string, locale: WebLocale): string {
  return WEB_MESSAGES[locale][key] ?? WEB_MESSAGES.en[key] ?? key;
}
