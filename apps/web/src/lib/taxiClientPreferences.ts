export type TaxiAmbiancePreference = "quiet" | "music" | "conversation" | "none";

export type TaxiClientPreferenceKey =
  | "prefer_electric_or_hybrid"
  | "non_smoking_driver"
  | "child_seat_required"
  | "pets_allowed"
  | "large_luggage"
  | "air_conditioning_required"
  | "phone_charger_requested"
  | "prefer_quiet_vehicle";

export type TaxiClientPreferences = Partial<Record<TaxiClientPreferenceKey, boolean>> & {
  ambiance?: TaxiAmbiancePreference;
};

export const DEFAULT_PREFERENCE_DROP_ORDER: TaxiClientPreferenceKey[] = [
  "child_seat_required",
  "non_smoking_driver",
  "phone_charger_requested",
  "large_luggage",
  "pets_allowed",
  "prefer_quiet_vehicle",
  "prefer_electric_or_hybrid",
  "air_conditioning_required",
];

export const TAXI_CLIENT_PREFERENCE_LABELS: Record<
  TaxiClientPreferenceKey,
  { emoji: string; label: string; driverLabel: string }
> = {
  prefer_electric_or_hybrid: {
    emoji: "⚡",
    label: "Véhicule électrique ou hybride",
    driverLabel: "Electric or Hybrid Preferred",
  },
  non_smoking_driver: {
    emoji: "🚭",
    label: "Chauffeur non-fumeur",
    driverLabel: "Non-Smoking Driver",
  },
  child_seat_required: {
    emoji: "👶",
    label: "Siège enfant disponible",
    driverLabel: "Child Seat Required",
  },
  pets_allowed: {
    emoji: "🐶",
    label: "Animaux acceptés",
    driverLabel: "Pets Allowed",
  },
  large_luggage: {
    emoji: "🧳",
    label: "Grand espace bagages",
    driverLabel: "Large Luggage",
  },
  air_conditioning_required: {
    emoji: "❄️",
    label: "Climatisation obligatoire",
    driverLabel: "Air Conditioning Required",
  },
  phone_charger_requested: {
    emoji: "🔌",
    label: "Chargeur téléphone (USB-C / Lightning)",
    driverLabel: "Phone Charger Requested",
  },
  prefer_quiet_vehicle: {
    emoji: "🔇",
    label: "Véhicule silencieux",
    driverLabel: "Quiet Vehicle Preferred",
  },
};

export const TAXI_CLIENT_PREFERENCE_KEYS = Object.keys(
  TAXI_CLIENT_PREFERENCE_LABELS,
) as TaxiClientPreferenceKey[];

export const DEFAULT_ENABLED_PREFERENCES: Record<TaxiClientPreferenceKey, boolean> =
  Object.fromEntries(
    TAXI_CLIENT_PREFERENCE_KEYS.map((key) => [key, true]),
  ) as Record<TaxiClientPreferenceKey, boolean>;

export const TAXI_AMBIANCE_LABELS: Record<
  Exclude<TaxiAmbiancePreference, "none">,
  { emoji: string; label: string; driverLabel: string }
> = {
  quiet: { emoji: "🔇", label: "Trajet calme", driverLabel: "Quiet Ride Requested" },
  music: { emoji: "🎵", label: "Musique", driverLabel: "Music Preferred" },
  conversation: { emoji: "🗣️", label: "Discussion", driverLabel: "Conversation Welcome" },
};

export type DriverCapabilityInput = {
  non_smoking?: boolean | null;
  child_seat_available?: boolean | null;
  pets_allowed?: boolean | null;
  large_luggage?: boolean | null;
  phone_charger_available?: boolean | null;
  quiet_vehicle?: boolean | null;
  has_air_conditioning?: boolean | null;
  fuel_type?: string | null;
  luggage_capacity?: string | null;
};

export function getDroppedPreferencesAtStage(
  dropOrder: TaxiClientPreferenceKey[],
  stage: number,
): TaxiClientPreferenceKey[] {
  return dropOrder.slice(0, Math.max(0, stage));
}

export function getEnforcedPreferences(params: {
  requested: TaxiClientPreferences;
  preferElectricOrHybrid?: boolean;
  dropOrder: TaxiClientPreferenceKey[];
  stage: number;
  enabled?: Partial<Record<TaxiClientPreferenceKey, boolean>>;
}): TaxiClientPreferences {
  const dropped = new Set(getDroppedPreferencesAtStage(params.dropOrder, params.stage));
  const enabled = params.enabled ?? {};
  const merged: TaxiClientPreferences = { ...params.requested };
  if (params.preferElectricOrHybrid) {
    merged.prefer_electric_or_hybrid = true;
  }

  const enforced: TaxiClientPreferences = {};
  for (const key of Object.keys(TAXI_CLIENT_PREFERENCE_LABELS) as TaxiClientPreferenceKey[]) {
    if (!merged[key]) continue;
    if (enabled[key] === false) continue;
    if (dropped.has(key)) continue;
    enforced[key] = true;
  }
  return enforced;
}

export function driverSatisfiesPreferences(params: {
  enforced: TaxiClientPreferences;
  driver: DriverCapabilityInput;
  vehicleClass?: string;
}): boolean {
  const { enforced, driver } = params;
  const vehicleClass = String(params.vehicleClass ?? "standard").toLowerCase();
  const comfortRequiresAc = vehicleClass === "comfort" || vehicleClass === "premium";

  if (enforced.non_smoking_driver && !driver.non_smoking) return false;
  if (enforced.child_seat_required && !driver.child_seat_available) return false;
  if (enforced.pets_allowed && !driver.pets_allowed) return false;
  if (
    enforced.large_luggage &&
    !driver.large_luggage &&
    !["large", "xl", "extra_large"].includes(String(driver.luggage_capacity ?? "").toLowerCase())
  ) {
    return false;
  }
  if (enforced.phone_charger_requested && !driver.phone_charger_available) return false;
  if (enforced.air_conditioning_required && !comfortRequiresAc && !driver.has_air_conditioning) {
    return false;
  }

  const fuel = String(driver.fuel_type ?? "").toLowerCase();
  const isGreen = fuel === "electric" || fuel === "hybrid" || fuel === "plug_in_hybrid";

  if (enforced.prefer_quiet_vehicle && !driver.quiet_vehicle && !isGreen) return false;
  if (enforced.prefer_electric_or_hybrid && !isGreen) return false;

  return true;
}

export function formatClientPreferencesForDriver(params: {
  clientPreferences?: TaxiClientPreferences | Record<string, unknown> | null;
  preferElectricOrHybrid?: boolean;
  ambiance?: TaxiAmbiancePreference | string | null;
}): Array<{ emoji: string; label: string }> {
  const lines: Array<{ emoji: string; label: string }> = [];
  const prefs = (params.clientPreferences ?? {}) as TaxiClientPreferences;

  if (params.preferElectricOrHybrid || prefs.prefer_electric_or_hybrid) {
    lines.push({
      emoji: TAXI_CLIENT_PREFERENCE_LABELS.prefer_electric_or_hybrid.emoji,
      label: TAXI_CLIENT_PREFERENCE_LABELS.prefer_electric_or_hybrid.driverLabel,
    });
  }

  for (const key of Object.keys(TAXI_CLIENT_PREFERENCE_LABELS) as TaxiClientPreferenceKey[]) {
    if (key === "prefer_electric_or_hybrid") continue;
    if (prefs[key]) {
      lines.push({
        emoji: TAXI_CLIENT_PREFERENCE_LABELS[key].emoji,
        label: TAXI_CLIENT_PREFERENCE_LABELS[key].driverLabel,
      });
    }
  }

  const ambiance = String(params.ambiance ?? prefs.ambiance ?? "none") as TaxiAmbiancePreference;
  if (ambiance !== "none" && TAXI_AMBIANCE_LABELS[ambiance as keyof typeof TAXI_AMBIANCE_LABELS]) {
    const row = TAXI_AMBIANCE_LABELS[ambiance as keyof typeof TAXI_AMBIANCE_LABELS];
    lines.push({ emoji: row.emoji, label: row.driverLabel });
  }

  return lines;
}

export function shouldAdvancePreferenceStage(params: {
  stageUntil: string | null;
  now?: Date;
}): boolean {
  if (!params.stageUntil) return false;
  return new Date(params.stageUntil).getTime() <= (params.now ?? new Date()).getTime();
}

export function buildPreferenceWidenClientMessage(unmet: string[]): string {
  if (unmet.length === 0) return "";
  return (
    "Nous n'avons trouvé aucun véhicule correspondant à tous vos critères. " +
    "Nous avons élargi la recherche afin de réduire votre temps d'attente."
  );
}
