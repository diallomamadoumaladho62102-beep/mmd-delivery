export type TaxiAddressConfig = {
  structured_address_mode: boolean;
  manual_pin_confirmation_required: boolean;
  landmark_prompt_required: boolean;
  street_number_required: boolean;
  postal_code_required: boolean;
  reverse_geocoding_enabled: boolean;
  minimum_location_accuracy_meters: number;
};

const WEST_AFRICA = new Set(["GN", "SN", "CI", "ML"]);

const USA_CONFIG: TaxiAddressConfig = {
  structured_address_mode: true,
  manual_pin_confirmation_required: false,
  landmark_prompt_required: false,
  street_number_required: true,
  postal_code_required: true,
  reverse_geocoding_enabled: true,
  minimum_location_accuracy_meters: 50,
};

const WEST_AFRICA_CONFIG: TaxiAddressConfig = {
  structured_address_mode: false,
  manual_pin_confirmation_required: true,
  landmark_prompt_required: true,
  street_number_required: false,
  postal_code_required: false,
  reverse_geocoding_enabled: true,
  minimum_location_accuracy_meters: 100,
};

const DEFAULT_CONFIG: TaxiAddressConfig = {
  structured_address_mode: false,
  manual_pin_confirmation_required: true,
  landmark_prompt_required: false,
  street_number_required: false,
  postal_code_required: false,
  reverse_geocoding_enabled: true,
  minimum_location_accuracy_meters: 75,
};

export function normalizeTaxiCountryCode(value: unknown): string {
  return String(value ?? "US")
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

export function defaultTaxiAddressConfig(countryCode: string): TaxiAddressConfig {
  const code = normalizeTaxiCountryCode(countryCode);
  if (code === "US") return { ...USA_CONFIG };
  if (WEST_AFRICA.has(code)) return { ...WEST_AFRICA_CONFIG };
  return { ...DEFAULT_CONFIG };
}

export function resolveTaxiAddressConfig(
  countryCode: string,
  metadata?: unknown,
): TaxiAddressConfig {
  const base = defaultTaxiAddressConfig(countryCode);
  const meta =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  const nested =
    meta.address_config && typeof meta.address_config === "object"
      ? (meta.address_config as Record<string, unknown>)
      : meta;

  const asBool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    return fallback;
  };

  const asMeters = (value: unknown, fallback: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(500, Math.max(10, Math.round(n)));
  };

  return {
    structured_address_mode: asBool(
      nested.structured_address_mode,
      base.structured_address_mode,
    ),
    manual_pin_confirmation_required: asBool(
      nested.manual_pin_confirmation_required,
      base.manual_pin_confirmation_required,
    ),
    landmark_prompt_required: asBool(
      nested.landmark_prompt_required,
      base.landmark_prompt_required,
    ),
    street_number_required: asBool(
      nested.street_number_required,
      base.street_number_required,
    ),
    postal_code_required: asBool(
      nested.postal_code_required,
      base.postal_code_required,
    ),
    reverse_geocoding_enabled: asBool(
      nested.reverse_geocoding_enabled,
      base.reverse_geocoding_enabled,
    ),
    minimum_location_accuracy_meters: asMeters(
      nested.minimum_location_accuracy_meters,
      base.minimum_location_accuracy_meters,
    ),
  };
}

export function isWestAfricaTaxiCountry(countryCode: string): boolean {
  return WEST_AFRICA.has(normalizeTaxiCountryCode(countryCode));
}
