import React, { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Location from "expo-location";
import { formatMoneyFromCents } from "../../i18n/formatters";
import { searchMapboxPlaces } from "../../lib/mapboxPlaces";
import { bookGuineaXl, fetchGuineaXlDepartures, quoteGuineaXl } from "../../lib/taxiXlApi";

type Seat = { seat_index: number; seat_role: string; booking_id: string | null };
type Departure = {
  id: string;
  passenger_capacity: number;
  guinea_xl_axes?: {
    origin_label?: string;
    destination_label?: string;
    front_seat_gnf?: number;
    other_seat_gnf?: number;
  } | null;
  guinea_xl_seats?: Seat[];
};

export default function GuineaXlRequestScreen() {
  const { t } = useTranslation();
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [selected, setSelected] = useState<Departure | null>(null);
  const [seats, setSeats] = useState<number[]>([]);
  const [weights, setWeights] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number } | null>(null);
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchGuineaXlDepartures()
      .then((payload) => setDepartures((payload.departures ?? []) as Departure[]))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("taxiXl.requestFailed")));
  }, [t]);

  const money = (value: unknown) => formatMoneyFromCents(Number(value ?? 0), "GNF");

  async function confirm() {
    if (!selected || !dropoff) return;
    setError(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setError(t("taxiXl.locationDenied"));
      return;
    }
    const position = await Location.getCurrentPositionAsync({});
    const baggage = weights
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ weightKg: Number(item) }));
    const body = {
      departureId: selected.id,
      pickupLat: position.coords.latitude,
      pickupLng: position.coords.longitude,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      seatIndexes: seats,
      baggage,
      idempotencyKey: `${selected.id}-${seats.join("-")}-${Date.now()}`,
    };
    try {
      const priced = await quoteGuineaXl(body);
      setQuote((priced as { quote?: Record<string, unknown> }).quote ?? null);
      await bookGuineaXl(body);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t("taxiXl.requestFailed"));
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("taxiXl.title")}</Text>
      <Text>{t("taxiXl.subtitle")}</Text>
      {departures.map((departure) => {
        const row = departure.guinea_xl_axes;
        const free = (departure.guinea_xl_seats ?? []).filter((seat) => !seat.booking_id).length;
        return (
          <TouchableOpacity key={departure.id} onPress={() => { setSelected(departure); setSeats([]); setQuote(null); }}>
            <Text>
              {row?.origin_label} → {row?.destination_label}
            </Text>
            <Text>
              {t("taxiXl.frontSeat")} {money(row?.front_seat_gnf)} · {t("taxiXl.otherSeat")} {money(row?.other_seat_gnf)}
            </Text>
            <Text>
              {t("taxiXl.capacity")} {departure.passenger_capacity} · {t("taxiXl.seatsLeft")} {free}
            </Text>
          </TouchableOpacity>
        );
      })}
      {selected ? (
        <View style={{ gap: 8 }}>
          <Text>{t("taxiXl.selectSeat")}</Text>
          {(selected.guinea_xl_seats ?? []).map((seat) => (
            <TouchableOpacity
              key={seat.seat_index}
              disabled={Boolean(seat.booking_id)}
              onPress={() =>
                setSeats((current) =>
                  current.includes(seat.seat_index)
                    ? current.filter((index) => index !== seat.seat_index)
                    : [...current, seat.seat_index],
                )
              }
            >
              <Text>
                {seat.seat_role === "front" ? t("taxiXl.frontSeat") : t("taxiXl.otherSeat")} {seat.seat_index}
                {seat.booking_id ? ` · ${t("taxiXl.taken")}` : seats.includes(seat.seat_index) ? " · ✓" : ""}
              </Text>
            </TouchableOpacity>
          ))}
          <Text>{t("taxiXl.backpackIncluded")}</Text>
          <TextInput
            value={weights}
            onChangeText={setWeights}
            placeholder={t("taxiXl.baggageHint")}
            keyboardType="numbers-and-punctuation"
          />
          <TextInput
            value={destinationQuery}
            onChangeText={setDestinationQuery}
            placeholder={t("taxiXl.searchDestination")}
          />
          <TouchableOpacity
            onPress={() => {
              void searchMapboxPlaces({ query: destinationQuery, country: "GN", limit: 1 }).then((places) => {
                const place = places[0];
                if (place) setDropoff({ lat: place.latitude, lng: place.longitude });
              });
            }}
          >
            <Text>{t("taxiXl.searchDestination")}</Text>
          </TouchableOpacity>
          <Text>{t("taxiXl.cash")}</Text>
          <Text>{t("taxiXl.orangeSoon")}</Text>
          {quote ? (
            <Text>
              {t("taxiXl.total")} {money(quote.totalGnf)} · {t("taxiXl.driverAmount")} {money(quote.driverAmountGnf)}
            </Text>
          ) : null}
          <TouchableOpacity onPress={() => void confirm()} disabled={seats.length === 0 || !dropoff}>
            <Text>{t("taxiXl.confirm")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {error ? <Text>{error}</Text> : null}
    </ScrollView>
  );
}
