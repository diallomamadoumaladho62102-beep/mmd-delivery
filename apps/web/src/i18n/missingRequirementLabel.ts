/**
 * Maps internal driver missing-requirement keys to localized UI labels.
 * Keys stay English (API/DB); only the displayed string is translated.
 */

const MISSING_REQUIREMENT_SOURCES: Record<string, string> = {
  "full name": "Nom complet",
  "phone number": "Téléphone",
  "emergency phone number": "Téléphone d’urgence",
  address: "Adresse",
  city: "Ville",
  state: "État",
  "zip code": "Code postal",
  "date of birth": "Date de naissance",
  "profile photo": "Photo personnelle",
  "ID card front": "Pièce d’identité recto",
  "ID card back": "Pièce d’identité verso",
  "active vehicle": "Véhicule actif",
  "license number": "Numéro du permis",
  "license expiry": "Expiration du permis",
  "license front": "Permis recto",
  "license back": "Permis verso",
  insurance: "Assurance",
  registration: "Carte grise",
  "vehicle brand": "Marque",
  "vehicle model": "Modèle",
  "vehicle year": "Année",
  "vehicle color": "Couleur",
  "plate number": "Plaque d’immatriculation",
  "transport mode": "Mode de transport",
};

export function missingRequirementSource(key: string): string {
  return MISSING_REQUIREMENT_SOURCES[key] ?? key;
}

export function missingRequirementLabel(
  key: string,
  t: (source: string) => string,
): string {
  return t(missingRequirementSource(key));
}

export function missingRequirementsSummary(
  keys: string[],
  t: (source: string) => string,
  limit = 4,
): string {
  const shown = keys.slice(0, limit).map((key) => missingRequirementLabel(key, t));
  const extra = keys.length > limit ? ` +${keys.length - limit}` : "";
  return `${t("Missing")}: ${shown.join(", ")}${extra}`;
}
