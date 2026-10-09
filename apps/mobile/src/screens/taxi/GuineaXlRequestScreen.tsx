import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Location from "expo-location";
import { formatMoneyFromCents } from "../../i18n/formatters";
import { searchMapboxPlaces } from "../../lib/mapboxPlaces";
import {
  bookGuineaXl,
  fetchGuineaXlDepartures,
  fetchMyGuineaXlBookings,
  quoteGuineaXl,
  xlErrorMessage,
  xlStatusLabel,
} from "../../lib/taxiXlApi";

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

type Mine = {
  id: string;
  status: string;
  payment_status: string;
  total_gnf: number;
  transport_gnf: number;
  baggage_gnf: number;
  guinea_xl_axes?: { origin_label?: string; destination_label?: string } | null;
};

type Quote = {
  totalGnf?: number;
  transportGnf?: number;
  baggageGnf?: number;
  driverAmountGnf?: number;
};

export default function GuineaXlRequestScreen() {
  const { t } = useTranslation();
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [axes, setAxes] = useState<unknown[]>([]);
  const [selected, setSelected] = useState<Departure | null>(null);
  const [seats, setSeats] = useState<number[]>([]);
  const [weights, setWeights] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void Promise.all([fetchGuineaXlDepartures(), fetchMyGuineaXlBookings()])
      .then(([payload, bookings]) => {
        setDepartures((payload.departures ?? []) as Departure[]);
        setAxes(payload.axes ?? []);
        setMine((bookings.bookings ?? []) as Mine[]);
      })
      .catch((cause: unknown) => setError(xlErrorMessage(cause, t)));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (value: unknown) => formatMoneyFromCents(Number(value ?? 0), "GNF");

  function baggageItems() {
    return weights
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ weightKg: Number(item) }));
  }

  async function requestQuote() {
    if (!selected || !dropoff || seats.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setBookingId(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError(t("taxiXl.locationDenied"));
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const key = `${selected.id}-${[...seats].sort((a, b) => a - b).join("-")}`;
      const body = {
        departureId: selected.id,
        pickupLat: position.coords.latitude,
        pickupLng: position.coords.longitude,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        seatIndexes: seats,
        baggage: baggageItems(),
        idempotencyKey: key,
      };
      const priced = await quoteGuineaXl(body);
      setQuote((priced as { quote?: Quote }).quote ?? null);
      setIdempotencyKey(key);
    } catch (cause: unknown) {
      setQuote(null);
      setError(xlErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!selected || !dropoff || !idempotencyKey || !quote || busy) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError(t("taxiXl.locationDenied"));
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const saved = await bookGuineaXl({
        departureId: selected.id,
        pickupLat: position.coords.latitude,
        pickupLng: position.coords.longitude,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        seatIndexes: seats,
        baggage: baggageItems(),
        idempotencyKey,
      });
      const payload = saved as { booking_id?: string; booking?: { id?: string } };
      setBookingId(payload.booking_id ?? payload.booking?.id ?? null);
      load();
    } catch (cause: unknown) {
      setError(xlErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("taxiXl.title")}</Text>
      <Text>{t("taxiXl.subtitle")}</Text>
      <Text>{t("taxiXl.originCurrent")}</Text>
      {axes.length === 0 ? <Text>{t("taxiXl.routeNotConfigured")}</Text> : null}
      {axes.length > 0 && departures.length === 0 ? <Text>{t("taxiXl.noDepartures")}</Text> : null}
      {departures.map((departure) => {
        const row = departure.guinea_xl_axes;
        const free = (departure.guinea_xl_seats ?? []).filter((seat) => !seat.booking_id).length;
        return (
          <TouchableOpacity
            key={departure.id}
            onPress={() => {
              setSelected(departure);
              setSeats([]);
              setQuote(null);
              setBookingId(null);
              setIdempotencyKey(null);
            }}
          >
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
              disabled={Boolean(seat.booking_id) || busy}
              onPress={() => {
                setQuote(null);
                setBookingId(null);
                setIdempotencyKey(null);
                setSeats((current) =>
                  current.includes(seat.seat_index)
                    ? current.filter((index) => index !== seat.seat_index)
                    : [...current, seat.seat_index],
                );
              }}
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
            onChangeText={(value) => {
              setWeights(value);
              setQuote(null);
              setIdempotencyKey(null);
            }}
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
                if (!place) return;
                setDropoff({ lat: place.latitude, lng: place.longitude });
                setDestinationName(place.name ?? destinationQuery);
                setQuote(null);
                setIdempotencyKey(null);
              });
            }}
          >
            <Text>{t("taxiXl.searchDestination")}</Text>
          </TouchableOpacity>
          {destinationName ? (
            <Text>
              {t("taxiXl.destinationChosen")} {destinationName}
            </Text>
          ) : null}
          <Text>{t("taxiXl.cash")}</Text>
          <Text>{t("taxiXl.orangeSoon")}</Text>
          <TouchableOpacity onPress={() => void requestQuote()} disabled={busy || seats.length === 0 || !dropoff}>
            <Text>{t("taxiXl.quoteAction")}</Text>
          </TouchableOpacity>
          {quote ? (
            <View style={{ gap: 4 }}>
              <Text>
                {t("taxiXl.transportAmount")} {money(quote.transportGnf)}
              </Text>
              <Text>
                {t("taxiXl.baggageAmount")} {money(quote.baggageGnf)}
              </Text>
              <Text>
                {t("taxiXl.total")} {money(quote.totalGnf)} · {t("taxiXl.driverAmount")} {money(quote.driverAmountGnf)}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity onPress={() => void confirm()} disabled={busy || !quote || !idempotencyKey}>
            <Text>{t("taxiXl.confirm")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text style={{ fontSize: 18, fontWeight: "700" }}>{t("taxiXl.myBookings")}</Text>
      {mine.length === 0 ? <Text>{t("taxiXl.noBookings")}</Text> : null}
      {mine.map((booking) => (
        <View key={booking.id} style={{ gap: 4 }}>
          <Text>
            {booking.guinea_xl_axes?.origin_label} → {booking.guinea_xl_axes?.destination_label}
          </Text>
          <Text>
            {t("taxiXl.bookingRef")} {booking.id}
          </Text>
          <Text>
            {t("taxiXl.transportAmount")} {money(booking.transport_gnf)} · {t("taxiXl.baggageAmount")}{" "}
            {money(booking.baggage_gnf)}
          </Text>
          <Text>
            {t("taxiXl.total")} {money(booking.total_gnf)} · {xlStatusLabel(booking.status, t)} ·{" "}
            {booking.payment_status === "cash_collected" ? t("taxiXl.paymentCollected") : t("taxiXl.paymentPending")}
          </Text>
        </View>
      ))}
      {bookingId ? (
        <View style={{ gap: 4 }}>
          <Text>{t("taxiXl.booked")}</Text>
          <Text>
            {t("taxiXl.bookingRef")} {bookingId}
          </Text>
          <Text>{t("taxiXl.paymentPending")}</Text>
          {quote ? (
            <Text>
              {t("taxiXl.total")} {money(quote.totalGnf)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text>{error}</Text> : null}
    </ScrollView>
  );
}
