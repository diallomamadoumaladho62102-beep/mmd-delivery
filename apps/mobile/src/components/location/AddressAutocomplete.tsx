import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  type TextInputProps,
} from "react-native";
import {
  searchMapboxPlaces,
  type MapboxPlaceSuggestion,
} from "../../lib/mapboxPlaces";
import { reverseGeocode } from "../../lib/reverseGeocode";
import { getFreshPosition } from "../../lib/locationPermissionState";

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;
const LIMIT = 5;

export type AddressAutocompleteProps = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (place: {
    fullAddress: string;
    name: string;
    latitude: number;
    longitude: number;
    id?: string;
  }) => void;
  placeholder?: string;
  proximity?: { lat: number; lng: number } | null;
  country?: string;
  showUseGps?: boolean;
  onGpsError?: (message: string) => void;
  style?: TextInputProps["style"];
  editable?: boolean;
};

export function AddressAutocomplete({
  value,
  onChangeText,
  onSelect,
  placeholder = "Enter address",
  proximity,
  country,
  showUseGps = false,
  onGpsError,
  style,
  editable = true,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<MapboxPlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickLockRef = useRef(false);

  const runSearch = useCallback(
    async (query: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const trimmed = query.trim();
      if (trimmed.length < MIN_CHARS) {
        setSuggestions([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const results = await searchMapboxPlaces({
          query: trimmed,
          proximity: proximity ?? undefined,
          country,
          limit: LIMIT,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSuggestions(results);
        setOpen(true);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setSuggestions([]);
        setError("Unable to find places");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [proximity, country]
  );

  useEffect(() => {
    if (pickLockRef.current) {
      pickLockRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(value);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, runSearch]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSelect = (place: MapboxPlaceSuggestion) => {
    pickLockRef.current = true;
    abortRef.current?.abort();
    setSuggestions([]);
    setOpen(false);
    onChangeText(place.fullAddress);
    onSelect({
      fullAddress: place.fullAddress,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      id: place.id,
    });
  };

  const handleUseGps = async () => {
    setGpsLoading(true);
    setError(null);
    try {
      const pos = await getFreshPosition({ timeoutMs: 8000 });
      if (
        pos.state !== "fresh" &&
        pos.state !== "cached" &&
        pos.state !== "weak_accuracy"
      ) {
        const msg =
          pos.state === "services_off"
            ? "Location services are off"
            : pos.state === "timeout"
              ? "GPS timed out"
              : "Location permission required";
        onGpsError?.(msg);
        setError(msg);
        return;
      }

      const geo = await reverseGeocode(pos.latitude, pos.longitude);
      pickLockRef.current = true;
      setSuggestions([]);
      setOpen(false);
      onChangeText(geo.fullAddress);
      onSelect({
        fullAddress: geo.fullAddress,
        name: geo.shortName,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    } catch {
      const msg = "Unable to read GPS";
      onGpsError?.(msg);
      setError(msg);
    } finally {
      setGpsLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={(text) => {
            onChangeText(text);
            setOpen(true);
          }}
          placeholder={placeholder}
          placeholderTextColor="#64748B"
          style={[styles.input, style]}
          editable={editable}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading ? (
          <ActivityIndicator
            color="#93C5FD"
            style={styles.spinner}
            size="small"
          />
        ) : null}
      </View>

      {showUseGps ? (
        <TouchableOpacity
          onPress={() => void handleUseGps()}
          disabled={gpsLoading}
          style={styles.gpsBtn}
        >
          {gpsLoading ? (
            <ActivityIndicator color="#93C5FD" />
          ) : (
            <Text style={styles.gpsText}>Use GPS</Text>
          )}
        </TouchableOpacity>
      ) : null}

      {error && (!suggestions.length || !open) ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      {open && suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => handleSelect(item)}
              style={styles.item}
            >
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.itemAddr} numberOfLines={2}>
                {item.fullAddress}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {open &&
      !loading &&
      value.trim().length >= MIN_CHARS &&
      suggestions.length === 0 &&
      !error ? (
        <Text style={styles.empty}>No places found</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  inputRow: {
    position: "relative",
  },
  input: {
    backgroundColor: "rgba(15,23,42,0.95)",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 14,
    padding: 14,
    paddingRight: 36,
    color: "#F8FAFC",
  },
  spinner: {
    position: "absolute",
    right: 12,
    top: 16,
  },
  gpsBtn: {
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(15,23,42,0.8)",
  },
  gpsText: {
    color: "#E2E8F0",
    fontWeight: "700",
  },
  list: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(2,6,23,0.98)",
    overflow: "hidden",
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(51,65,85,0.6)",
  },
  itemName: {
    color: "#F8FAFC",
    fontWeight: "700",
    fontSize: 13,
  },
  itemAddr: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  error: {
    color: "#FCA5A5",
    fontSize: 12,
  },
  empty: {
    color: "#64748B",
    fontSize: 12,
  },
});

export default AddressAutocomplete;
