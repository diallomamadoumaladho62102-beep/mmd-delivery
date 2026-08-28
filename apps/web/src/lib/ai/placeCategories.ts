export type PlaceCategoryId =
  | "hospital"
  | "clinic"
  | "pharmacy"
  | "school"
  | "university"
  | "daycare"
  | "mosque"
  | "church"
  | "synagogue"
  | "place_of_worship"
  | "gas_station"
  | "police"
  | "fire_station"
  | "hotel"
  | "motel"
  | "parking"
  | "park"
  | "playground"
  | "supermarket"
  | "grocery"
  | "mall"
  | "bank"
  | "atm"
  | "restaurant"
  | "cafe"
  | "transit_station"
  | "train_station"
  | "bus_stop"
  | "airport"
  | "public_place";

export type PlaceCategoryDef = {
  id: PlaceCategoryId;
  mapboxQuery: string;
  aliases: string[];
};

/**
 * Extensible public-place categories. Add an entry here to support a new type.
 * Mapbox queries stay in English POI terms; aliases cover FR/EN (and common variants).
 */
export const PLACE_CATEGORIES: readonly PlaceCategoryDef[] = [
  {
    id: "hospital",
    mapboxQuery: "hospital",
    aliases: ["hospital", "hopital", "hopitaux", "emergency room", "salle d'urgence", "urgences"],
  },
  {
    id: "clinic",
    mapboxQuery: "clinic",
    aliases: ["clinic", "clinique", "medical clinic"],
  },
  {
    id: "pharmacy",
    mapboxQuery: "pharmacy",
    aliases: ["pharmacy", "pharmacie", "drugstore"],
  },
  {
    id: "school",
    mapboxQuery: "school",
    aliases: ["school", "ecole", "elementary", "lycee", "college"],
  },
  {
    id: "university",
    mapboxQuery: "university",
    aliases: ["university", "universite", "campus"],
  },
  {
    id: "daycare",
    mapboxQuery: "daycare",
    aliases: ["daycare", "creche", "nursery school", "garderie"],
  },
  {
    id: "mosque",
    mapboxQuery: "mosque",
    aliases: ["mosque", "mosquee", "masjid"],
  },
  {
    id: "church",
    mapboxQuery: "church",
    aliases: ["church", "eglise", "chapel", "cathedrale"],
  },
  {
    id: "synagogue",
    mapboxQuery: "synagogue",
    aliases: ["synagogue", "temple juif"],
  },
  {
    id: "place_of_worship",
    mapboxQuery: "place of worship",
    aliases: ["place of worship", "lieu de culte", "temple", "prier", "pray"],
  },
  {
    id: "gas_station",
    mapboxQuery: "gas station",
    aliases: ["gas station", "station-service", "station service", "fuel", "essence"],
  },
  {
    id: "police",
    mapboxQuery: "police station",
    aliases: ["police station", "poste de police", "commissariat"],
  },
  {
    id: "fire_station",
    mapboxQuery: "fire station",
    aliases: ["fire station", "caserne", "pompiers", "fire department"],
  },
  {
    id: "hotel",
    mapboxQuery: "hotel",
    aliases: ["hotel", "hotels"],
  },
  {
    id: "motel",
    mapboxQuery: "motel",
    aliases: ["motel"],
  },
  {
    id: "parking",
    mapboxQuery: "parking",
    aliases: ["parking", "parkings", "car park", "stationnement", "garer"],
  },
  {
    id: "park",
    mapboxQuery: "park",
    aliases: ["park", "parc", "garden", "jardin"],
  },
  {
    id: "playground",
    mapboxQuery: "playground",
    aliases: ["playground", "parc de jeux", "aire de jeux", "play area"],
  },
  {
    id: "supermarket",
    mapboxQuery: "supermarket",
    aliases: ["supermarket", "supermarche", "walmart", "grocery store"],
  },
  {
    id: "grocery",
    mapboxQuery: "grocery",
    aliases: ["grocery", "epicerie", "alimentation"],
  },
  {
    id: "mall",
    mapboxQuery: "shopping mall",
    aliases: ["mall", "centre commercial", "shopping center"],
  },
  {
    id: "bank",
    mapboxQuery: "bank",
    aliases: ["bank", "banque"],
  },
  {
    id: "atm",
    mapboxQuery: "atm",
    aliases: ["atm", "distributeur", "dab", "cash machine"],
  },
  {
    id: "restaurant",
    mapboxQuery: "restaurant",
    aliases: ["restaurant", "restaurants"],
  },
  {
    id: "cafe",
    mapboxQuery: "cafe",
    aliases: ["cafe", "coffee shop", "coffee"],
  },
  {
    id: "transit_station",
    mapboxQuery: "transit station",
    aliases: ["transit", "station de transport", "metro", "subway"],
  },
  {
    id: "train_station",
    mapboxQuery: "train station",
    aliases: ["train station", "gare"],
  },
  {
    id: "bus_stop",
    mapboxQuery: "bus stop",
    aliases: ["bus stop", "arret de bus", "bus station", "station de bus"],
  },
  {
    id: "airport",
    mapboxQuery: "airport",
    aliases: ["airport", "aeroport"],
  },
  {
    id: "public_place",
    mapboxQuery: "point of interest",
    aliases: ["public place", "lieu public"],
  },
];

const NEED_PATTERNS: Array<{ category: PlaceCategoryId; pattern: RegExp }> = [
  { category: "parking", pattern: /\b(garer ma voiture|park (my )?car|endroit ou garer|stationner)\b/ },
  { category: "playground", pattern: /\b(enfant veut jouer|child wants to play|aire de jeux|parc de jeux)\b/ },
  { category: "park", pattern: /\b(trouve[- ]moi un parc|find (me )?a park)\b/ },
  { category: "place_of_worship", pattern: /\b(endroit pour prier|place to pray|besoin de prier)\b/ },
  { category: "hospital", pattern: /\b(je suis malade|i('m| am) sick|emergency room|salle d'urgence)\b/ },
  { category: "bus_stop", pattern: /\b(prendre le bus|catch (a |the )?bus|bus stop|arret de bus)\b/ },
];

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePlaceCategory(raw: string): PlaceCategoryId | null {
  const text = fold(raw);
  if (!text) return null;

  for (const row of NEED_PATTERNS) {
    if (row.pattern.test(text)) return row.category;
  }

  let best: { id: PlaceCategoryId; len: number } | null = null;
  for (const def of PLACE_CATEGORIES) {
    for (const alias of def.aliases) {
      const needle = fold(alias);
      if (!needle) continue;
      if (text === needle || text.includes(needle) || needle.includes(text)) {
        if (!best || needle.length > best.len) {
          best = { id: def.id, len: needle.length };
        }
      }
    }
  }
  return best?.id ?? null;
}

export function mapboxQueryForCategory(id: PlaceCategoryId | null): string | null {
  if (!id) return null;
  return PLACE_CATEGORIES.find((row) => row.id === id)?.mapboxQuery ?? null;
}

export function isGenericCategoryQuery(query: string, category: PlaceCategoryId | null): boolean {
  const folded = fold(query);
  if (!folded) return true;
  if (!category) return false;
  const def = PLACE_CATEGORIES.find((row) => row.id === category);
  if (!def) return false;
  return [def.mapboxQuery, ...def.aliases].some((alias) => fold(alias) === folded);
}

export function wantsNearestPlace(message: string): boolean {
  const text = fold(message);
  return /\b(nearest|closest|le plus proche|la plus proche|pres de moi|near me|a proximite|proche)\b/.test(
    text
  );
}

export type InferredPlaceSearch = {
  category: PlaceCategoryId | null;
  query: string;
  nearest: boolean;
  named: boolean;
};

export function inferPlaceSearchFromMessage(message: string): InferredPlaceSearch {
  const text = fold(message);
  const category = resolvePlaceCategory(text);
  const nearest = wantsNearestPlace(text);
  const namedMatch = text.match(
    /\b(nomme[e]?|called|qui s'appelle|named|l'hopital|l hopital|hotel|mosquee|eglise)\s+([a-z0-9][\w\s'-]{1,80})/i
  );
  const named = Boolean(
    namedMatch || /\b(adresse de|address of|ou se trouve)\b/.test(text) && /[A-Z]/.test(message)
  );
  const queryFromName = namedMatch?.[2]?.trim() ?? "";
  const query =
    queryFromName ||
    mapboxQueryForCategory(category) ||
    text.replace(
      /\b(trouve[- ]moi|find me|donne[- ]moi|where is|ou est|le plus proche|la plus proche|near me|pres de moi)\b/g,
      ""
    ).trim();

  return {
    category,
    query: query.slice(0, 180),
    nearest,
    named,
  };
}
