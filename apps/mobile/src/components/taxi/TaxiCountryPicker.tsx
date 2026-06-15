import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  fetchTaxiCountries,
  type TaxiCountryOption,
} from "../../lib/taxiClientApi";
import {
  getTaxiCountryLabel,
  getTaxiUiString,
  resolveTaxiLanguageForCountry,
} from "../../lib/taxiLocalization";

import { isDevCountryPickerEnabled } from "../../lib/marketScope";

type Props = {
  value: string;
  onChange: (countryCode: string, currencyCode: string) => void;
};

export default function TaxiCountryPicker({ value, onChange }: Props) {
  if (!isDevCountryPickerEnabled()) {
    return null;
  }
  const [countries, setCountries] = useState<TaxiCountryOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchTaxiCountries()
      .then((res) => {
        const list = (res?.countries ?? []) as TaxiCountryOption[];
        setCountries(list);
      })
      .catch(() => setCountries([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(
    () => countries.find((c) => c.country_code === value) ?? null,
    [countries, value]
  );

  if (loading) {
    return (
      <View style={{ paddingVertical: 8 }}>
        <ActivityIndicator color="#93C5FD" />
      </View>
    );
  }

  if (countries.length === 0) {
    return (
      <Text style={{ color: "#94A3B8", fontSize: 13 }}>
        Country: {value} (offline fallback)
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#CBD5E1", fontWeight: "600" }}>
          {getTaxiUiString("country", value)}
        </Text>
        {selected ? (
          <Text style={{ color: "#64748B", fontSize: 12 }}>
            {getTaxiUiString("currency", value)} · {selected.currency_code}
          </Text>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {countries.map((country) => {
            const active = country.country_code === value;
            return (
              <TouchableOpacity
                key={country.country_code}
                onPress={() =>
                  onChange(country.country_code, country.currency_code)
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: active ? "#38BDF8" : "#334155",
                  backgroundColor: active
                    ? "rgba(56,189,248,0.12)"
                    : "rgba(15,23,42,0.95)",
                }}
              >
                <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
                  {country.country_code}
                </Text>
                <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 2 }}>
                  {getTaxiCountryLabel(
                    country.country_code,
                    resolveTaxiLanguageForCountry(country.country_code)
                  )}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
