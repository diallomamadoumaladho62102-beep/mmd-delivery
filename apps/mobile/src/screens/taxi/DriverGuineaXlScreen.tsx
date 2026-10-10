import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { supabase } from "../../lib/supabase";
import {
  installXlGpsCapture,
  readActiveXlDeparture,
  recordXlDriverAction,
  rememberActiveXlDeparture,
  type XlActiveDeparture,
} from "../../lib/xlProgressCapture";
import { flushXlProgress, readXlProgress } from "../../lib/xlProgressQueue";
import type { XlProgressKind, XlQueuedProgress } from "../../../../../shared/xlSegmentProgress";
import { interpretXlProgressSyncResponse, xlProgressSyncEvents } from "../../../../../shared/xlProgressWire";
import { formatMoneyFromCents } from "../../i18n/formatters";
import {
  collectGuineaXlCash,
  xlStatusLabel,
  completeGuineaXlDeparture,
  fetchGuineaXlDepartures,
  openGuineaXlDeparture,
  syncGuineaXlProgress,
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
  segment_run?: boolean;
  stops?: string[];
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
  const [manualReason, setManualReason] = useState("");
  const [queued, setQueued] = useState<XlQueuedProgress[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const network = useNetworkStatus();
  const wasOffline = useRef(false);

  const sendPending = useCallback(async (pending: XlQueuedProgress[]) => {
    try {
      return interpretXlProgressSyncResponse(await syncGuineaXlProgress(xlProgressSyncEvents(pending)));
    } catch {
      return { ok: false as const };
    }
  }, []);

  const syncPending = useCallback(async () => {
    await flushXlProgress(AsyncStorage, sendPending);
    const [rows, active] = await Promise.all([readXlProgress(AsyncStorage), readActiveXlDeparture(AsyncStorage)]);
    setQueued(rows);
    setActiveId(active?.departureId ?? null);
  }, [sendPending]);

  const load = useCallback(() => {
    void Promise.all([fetchGuineaXlDepartures(), fetchGuineaXlDepartures("driver")])
      .then(async ([catalog, mine]) => {
        const rows = (mine.departures ?? []) as Departure[];
        setAxes((catalog.axes ?? []) as Axis[]);
        setDepartures(rows);
        const existing = await readActiveXlDeparture(AsyncStorage);
        const stillOpen = rows.some((row) => row.id === existing?.departureId && row.status === "open");
        if (existing && !stillOpen) {
          await rememberActiveXlDeparture(AsyncStorage, null);
          setActiveId(null);
          return;
        }
        const openSegments = rows.filter(
          (row) => row.status === "open" && row.segment_run === true && (row.stops?.length ?? 0) >= 2,
        );
        if (!existing && openSegments.length === 1) {
          const session = await supabase.auth.getSession();
          const driverId = session.data.session?.user?.id;
          const stops = openSegments[0]?.stops;
          if (driverId && stops) {
            await rememberActiveXlDeparture(AsyncStorage, {
              departureId: openSegments[0].id,
              driverId,
              stops,
            });
            setActiveId(openSegments[0].id);
          }
        }
      })
      .catch((cause: unknown) => setMessage(xlErrorMessage(cause, t)));
  }, [t]);

  useEffect(() => {
    installXlGpsCapture(AsyncStorage, sendPending);
    load();
    void syncPending();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncPending();
    });
    return () => subscription.remove();
  }, [load, sendPending, syncPending]);

  useEffect(() => {
    if (network.quality === "offline") {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void syncPending();
    }
  }, [network.quality, syncPending]);

  const money = (value: number) => formatMoneyFromCents(value, "GNF");

  async function follow(departure: Departure) {
    const session = await supabase.auth.getSession();
    const driverId = session.data.session?.user?.id;
    if (!driverId || !departure.stops || departure.stops.length < 2) {
      setMessage(t("taxiXl.requestFailed"));
      return;
    }
    const active: XlActiveDeparture = { departureId: departure.id, driverId, stops: departure.stops };
    await rememberActiveXlDeparture(AsyncStorage, active);
    setActiveId(departure.id);
    setMessage(t("taxiXl.followingDeparture"));
  }

  async function record(
    departure: Departure,
    kind: Exclude<XlProgressKind, "gps">,
    placement: "start" | "next" | "current",
  ) {
    if (busy) return;
    if (kind === "progress_reconciled" && !manualReason.trim()) {
      setMessage(t("taxiXl.notGpsProof"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const session = await supabase.auth.getSession();
      const driverId = session.data.session?.user?.id;
      if (!driverId || !departure.stops || departure.stops.length < 2) {
        setMessage(t("taxiXl.requestFailed"));
        return;
      }
      const active: XlActiveDeparture = { departureId: departure.id, driverId, stops: departure.stops };
      await rememberActiveXlDeparture(AsyncStorage, active);
      setActiveId(departure.id);
      const saved = await recordXlDriverAction(AsyncStorage, {
        departure: active,
        kind,
        placement,
        capturedAtMs: Date.now(),
        reason: kind === "progress_reconciled" ? manualReason.trim() : null,
      });
      if (saved.ok === false) {
        setMessage(t(saved.error === "xl_progress_duplicate" ? "taxiXl.progressDuplicate" : "taxiXl.progressBlocked"));
        return;
      }
      const event = saved.event;
      const manual = kind === "progress_reconciled" ? ` ${t("taxiXl.notGpsProof")}` : "";
      if (event.syncStatus === "rejected") setMessage(`${t("taxiXl.progressRejected")}${manual}`);
      else if (event.receivedAtMs != null && event.applied) setMessage(`${t("taxiXl.progressAccepted")}${manual}`);
      else if (event.receivedAtMs != null) setMessage(`${t("taxiXl.progressNotApplied")}${manual}`);
      else setMessage(`${network.quality === "offline" ? t("taxiXl.progressOffline") : t("taxiXl.progressPending")}${manual}`);
      await syncPending();
    } catch (cause: unknown) {
      setMessage(xlErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

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
              {t("taxiXl.capacity")} {departure.passenger_capacity} · {xlStatusLabel(departure.status, t)}
              {departure.segment_run ? ` · ${t("taxiXl.segmentDeparture")}` : ""}
            </Text>
            {(departure.stops ?? []).length >= 2 ? (
              <View style={{ gap: 4 }}>
                <Text>{(departure.stops ?? []).join(" → ")}</Text>
                {activeId === departure.id ? <Text>{t("taxiXl.followingDeparture")}</Text> : null}
                <TouchableOpacity disabled={busy} onPress={() => void follow(departure)}>
                  <Text>{t("taxiXl.followDeparture")}</Text>
                </TouchableOpacity>
                {departure.status === "open" ? (
                  <View style={{ gap: 4 }}>
                    <TouchableOpacity disabled={busy} onPress={() => void record(departure, "stop_reached", "start")}>
                      <Text>{t("taxiXl.startRun")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy} onPress={() => void record(departure, "stop_reached", "next")}>
                      <Text>{t("taxiXl.arriveNext")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy} onPress={() => void record(departure, "passenger_picked_up", "current")}>
                      <Text>{t("taxiXl.pickUpPassenger")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy} onPress={() => void record(departure, "passenger_dropped_off", "current")}>
                      <Text>{t("taxiXl.dropOffPassenger")}</Text>
                    </TouchableOpacity>
                    <TextInput
                      value={manualReason}
                      onChangeText={setManualReason}
                      placeholder={t("taxiXl.manualReason")}
                    />
                    <TouchableOpacity disabled={busy} onPress={() => void record(departure, "progress_reconciled", "next")}>
                      <Text>{t("taxiXl.manualStop")}</Text>
                    </TouchableOpacity>
                    <Text>{t("taxiXl.notGpsProof")}</Text>
                  </View>
                ) : null}
                {queued
                  .filter((event) => event.departureId === departure.id)
                  .map((event) => (
                    <Text key={event.eventId}>
                      {event.kind}
                      {event.stopIndex == null ? "" : ` ${event.stopIndex}`}
                      {" · "}
                      {event.syncStatus === "rejected"
                        ? `${t("taxiXl.progressRejected")}${event.rejection ? ` (${event.rejection})` : ""}`
                        : event.receivedAtMs == null
                          ? t("taxiXl.progressPending")
                          : event.applied
                            ? t("taxiXl.progressAccepted")
                            : t("taxiXl.progressNotApplied")}
                      {event.kind === "progress_reconciled" ? ` · ${t("taxiXl.notGpsProof")}` : ""}
                    </Text>
                  ))}
              </View>
            ) : null}
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
