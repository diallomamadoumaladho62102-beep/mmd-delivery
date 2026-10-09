import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatMoneyFromCents } from "../../i18n/formatters";
import {
  collectGuineaXlCash,
  completeGuineaXlDeparture,
  fetchGuineaXlDepartures,
  openGuineaXlDeparture,
  xlErrorMessage,
} from "../../lib/taxiXlApi";

type Axis = {
  id: string;
  origin_label: string;
  destination_label: string;
  front_seat_gnf: number;
  other_seat_gnf: number;
};

type Seat = { seat_index: number; seat_role: string; booking_id: string | null };

type Booking = {
  id: string;
  seat_indexes: number[];
  status: string;
  payment_status: string;
  total_gnf: number;
  transport_gnf: number;
  baggage_gnf: number;
  driver_amount_gnf: number;
};

type Departure = {
  id: string;
  passenger_capacity: number;
  status: string;
  guinea_xl_axes?: { origin_label?: string; destination_label?: string } | null;
  guinea_xl_seats?: Seat[];
  bookings?: Booking[];
};

export default function DriverGuineaXlScreen() {
  const { t } = useTranslation();
  const [axes, setAxes] = useState<Axis[]>([]);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [capacity, setCapacity] = useState<4 | 5 | 6 | 7>(4);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void Promise.all([fetchGuineaXlDepartures(), fetchGuineaXlDepartures("driver")])
      .then(([catalog, mine]) => {
        setAxes((catalog.axes ?? []) as Axis[]);
        setDepartures((mine.departures ?? []) as Departure[]);
      })
      .catch((cause: unknown) => setMessage(xlErrorMessage(cause, t)));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (value: number) => formatMoneyFromCents(value, "GNF");

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      const idempotent =
        typeof result === "object" &&
        result != null &&
        "idempotent" in result &&
        (result as { idempotent?: boolean }).idempotent === true;
      setMessage(idempotent ? t("taxiXl.cashAlreadyCollected") : success);
      load();
    } catch (cause: unknown) {
      setMessage(xlErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("taxiXl.driverTitle")}</Text>
      <Text>{t("taxiXl.driverHint")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {([4, 5, 6, 7] as const).map((value) => (
          <TouchableOpacity key={value} onPress={() => setCapacity(value)}>
            <Text>
              {value} {capacity === value ? "· ✓" : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {axes.length === 0 ? <Text>{t("taxiXl.routeNotConfigured")}</Text> : null}
      {axes.map((axis) => (
        <TouchableOpacity
          key={axis.id}
          disabled={busy}
          onPress={() =>
            void run(
              () => openGuineaXlDeparture({ axisId: axis.id, capacity }),
              t("taxiXl.departureOpened"),
            )
          }
        >
          <Text>
            {axis.origin_label} ↔ {axis.destination_label}
          </Text>
          <Text>
            {t("taxiXl.frontSeat")} {money(axis.front_seat_gnf)} · {t("taxiXl.otherSeat")} {money(axis.other_seat_gnf)}
          </Text>
          <Text>{t("taxiXl.driverAmountNote")}</Text>
        </TouchableOpacity>
      ))}

      <Text style={{ fontSize: 18, fontWeight: "700" }}>{t("taxiXl.myDepartures")}</Text>
      {departures.length === 0 ? <Text>{t("taxiXl.noDepartures")}</Text> : null}
      {departures.map((departure) => {
        const seats = departure.guinea_xl_seats ?? [];
        const reserved = seats.filter((seat) => seat.booking_id);
        const available = seats.filter((seat) => !seat.booking_id);
        const bookings = (departure.bookings ?? []).filter((booking) => booking.status !== "canceled");
        const passengers = bookings.reduce((sum, booking) => sum + (booking.seat_indexes?.length ?? 0), 0);
        const axis = departure.guinea_xl_axes;
        return (
          <View key={departure.id} style={{ gap: 6 }}>
            <Text style={{ fontWeight: "700" }}>
              {axis?.origin_label} → {axis?.destination_label}
            </Text>
            <Text>
              {t("taxiXl.capacity")} {departure.passenger_capacity} · {departure.status}
            </Text>
            <Text>
              {t("taxiXl.passengers")} {passengers}
            </Text>
            <Text>
              {t("taxiXl.reservedSeats")} {reserved.map((seat) => seat.seat_index).join(", ") || "—"}
            </Text>
            <Text>
              {t("taxiXl.availableSeats")} {available.map((seat) => seat.seat_index).join(", ") || "—"}
            </Text>
            {departure.status === "open" ? (
              <TouchableOpacity
                disabled={busy}
                onPress={() =>
                  void run(
                    () => completeGuineaXlDeparture(departure.id),
                    t("taxiXl.departureCompleted"),
                  )
                }
              >
                <Text>{t("taxiXl.completeDeparture")}</Text>
              </TouchableOpacity>
            ) : null}
            {bookings.map((booking) => (
              <View key={booking.id} style={{ gap: 4 }}>
                <Text>
                  {t("taxiXl.bookingRef")} {booking.id}
                </Text>
                <Text>
                  {t("taxiXl.passengers")} {booking.seat_indexes?.length ?? 0} · {t("taxiXl.reservedSeats")}{" "}
                  {(booking.seat_indexes ?? []).join(", ")}
                </Text>
                <Text>
                  {t("taxiXl.transportAmount")} {money(booking.transport_gnf)} · {t("taxiXl.baggageAmount")}{" "}
                  {money(booking.baggage_gnf)}
                </Text>
                <Text>
                  {t("taxiXl.expectedAmount")} {money(booking.total_gnf)} · {t("taxiXl.driverAmount")}{" "}
                  {money(booking.driver_amount_gnf)}
                </Text>
                <Text>
                  {booking.payment_status === "cash_collected"
                    ? t("taxiXl.paymentCollected")
                    : t("taxiXl.paymentPending")}
                </Text>
                {booking.status === "completed" && booking.payment_status === "pending_cash" ? (
                  <TouchableOpacity
                    disabled={busy}
                    onPress={() =>
                      void run(() => collectGuineaXlCash(booking.id), t("taxiXl.cashCollected"))
                    }
                  >
                    <Text>{t("taxiXl.collectCash")}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}
      {message ? <Text>{message}</Text> : null}
    </ScrollView>
  );
}
