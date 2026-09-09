import type { WebLocale } from "@/i18n/locales";
import { ADMIN_UI_CATALOG } from "@/i18n/adminUiCatalog.generated";
import { adminNavLabel } from "@/i18n/adminNavI18n";

const FRENCH_SOURCE_EN: Record<string, string> = {
  "Chargement…": "Loading…",
  Chargement: "Loading",
  Actualiser: "Refresh",
  Enregistrer: "Save",
  Statut: "Status",
  Pays: "Country",
  Actif: "Active",
  Inactif: "Inactive",
  Annuler: "Cancel",
  Confirmer: "Confirm",
  Supprimer: "Delete",
  Modifier: "Edit",
  Rechercher: "Search",
  Filtrer: "Filter",
  Retour: "Back",
  Fermer: "Close",
  Connexion: "Log in",
  Inscription: "Sign up",
  "En attente": "Pending",
  Approuver: "Approve",
  Refuser: "Refuse",
  Activer: "Enable",
  Désactiver: "Disable",
  Rafraîchir: "Refresh",
  Consulter: "View",
  "Revue manuelle": "Manual review",
  Masquer: "Hide",
  Ville: "City",
  Abonnements: "Subscriptions",
  Ajustements: "Adjustments",
  Rapprochements: "Reconciliations",
  "Crédit MMD": "MMD Credit",
  "Vue générale": "Overview",
  Trésorerie: "Treasury",
  Revenus: "Revenue",
  Dépenses: "Expenses",
  Remboursements: "Refunds",
  Partenaires: "Partners",
  Litiges: "Disputes",
  "Grand livre": "Ledger",
  Périodes: "Periods",
  Rapports: "Reports",
};

function looksNonEnglishSource(source: string): boolean {
  if (FRENCH_SOURCE_EN[source]) return true;
  return /[àâäéèêëïîôùûüçœæÀÂÄÉÈÊËÏÎÔÙÛÜÇ…]/.test(source);
}

/**
 * Translate Admin Control Center UI using the source string as key.
 * Catalog entries may include an optional `en` for non-English source keys.
 */
export function adminT(source: string, locale: WebLocale): string {
  if (!source) return source;
  const entry = ADMIN_UI_CATALOG[source];

  if (locale === "en") {
    const english = entry?.en;
    const preferCatalogEnglish =
      typeof english === "string" &&
      english.length > 0 &&
      english !== source &&
      (looksNonEnglishSource(source) || source.includes(" ") || Boolean(FRENCH_SOURCE_EN[source]));
    if (preferCatalogEnglish) return english;
    if (FRENCH_SOURCE_EN[source]) return FRENCH_SOURCE_EN[source];
    return source;
  }

  if (entry) {
    const localized = entry[locale];
    if (typeof localized === "string" && localized.length > 0) return localized;
  }
  const fromNav = adminNavLabel(source, locale);
  if (fromNav !== source) return fromNav;
  return source;
}

export function adminTMany(
  values: Record<string, string>,
  locale: WebLocale
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = adminT(v, locale);
  }
  return out;
}
