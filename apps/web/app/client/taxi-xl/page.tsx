"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { webTaxiFetch } from "@/lib/webTaxiSession";

const SEGMENTS = [
  ["Conakry", "Kindia"],
  ["Kindia", "Mamou"],
  ["Mamou", "Dalaba"],
  ["Dalaba", "Pita"],
  ["Pita", "Labé"],
  ["Labé", "Yembering"],
  ["Yembering", "Dougountounny"],
  ["Yembering", "Mali Centre"],
] as const;

const PLACES = [
  "Conakry",
  "Kindia",
  "Mamou",
  "Dalaba",
  "Pita",
  "Labé",
  "Yembering",
  "Dougountounny",
  "Mali Centre",
] as const;

type BookingRow = {
  id?: string;
  status?: string;
  total_gnf?: number;
  currency?: string;
};

export default function WebTaxiXlPage() {
  const [originLabel, setOriginLabel] = useState<string>(PLACES[0]);
  const [destinationLabel, setDestinationLabel] = useState<string>(PLACES[1]);
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void webTaxiFetch("/api/taxi/xl/bookings").then((result) => {
      if (!mounted || !result.ok) return;
      const rows = Array.isArray(result.body.bookings) ? result.body.bookings : [];
      setBookings(rows.slice(0, 8) as BookingRow[]);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function requestQuote() {
    if (originLabel === destinationLabel) {
      setMessage("Choose two different places. The server accepts only one road path.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setQuote(null);
    const result = await webTaxiFetch("/api/taxi/xl/quote", {
      method: "POST",
      body: JSON.stringify({
        bookingKind: "segment",
        originLabel,
        destinationLabel,
        countryCode: "GN",
        currency: "GNF",
      }),
    });
    setBusy(false);
    if (result.status === 401) {
      setMessage("Sign in to request a Guinea XL quote.");
      return;
    }
    if (!result.ok) {
      setMessage(String(result.body.error ?? "Quote failed"));
      return;
    }
    setQuote(result.body);
  }

  async function confirmQuote() {
    if (quote?.commercial_booking !== true) {
      setMessage("Commercial segment booking is closed. This quote is not a reservation.");
      return;
    }
    setBusy(true);
    const result = await webTaxiFetch("/api/taxi/xl/bookings", {
      method: "POST",
      body: JSON.stringify({
        bookingKind: "segment",
        originLabel,
        destinationLabel,
        countryCode: "GN",
        currency: "GNF",
        totalGnf: (quote.quote as { total_gnf?: number } | undefined)?.total_gnf,
        idempotencyKey: `web-segment-${Date.now()}-${originLabel}-${destinationLabel}`.replace(/\s+/g, ""),
      }),
    });
    setBusy(false);
    setMessage(result.ok ? "The server accepted the booking." : String(result.body.error ?? "Booking refused"));
  }

  const segmentQuote = quote?.quote as { total_gnf?: number; definitive?: boolean } | undefined;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6 text-slate-100">
      <h1 className="text-2xl font-bold">Taxi XL Guinea on the web</h1>
      <p className="text-sm text-slate-300">
        Segment prices come from the server. A quote is not a confirmed reservation while commercial booking is closed.
        Yembering to Dougountounny and Yembering to Mali Centre stay separate.
      </p>
      <div className="grid gap-2">
        {SEGMENTS.map(([origin, destination]) => (
          <button
            key={`${origin}-${destination}`}
            type="button"
            className="rounded border border-white/20 px-3 py-2 text-left text-sm"
            onClick={() => {
              setOriginLabel(origin);
              setDestinationLabel(destination);
              setQuote(null);
            }}
          >
            {origin} → {destination}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        Origin
        <select className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={originLabel} onChange={(event) => setOriginLabel(event.target.value)}>
          {PLACES.map((place) => <option key={place}>{place}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        Destination
        <select className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={destinationLabel} onChange={(event) => setDestinationLabel(event.target.value)}>
          {PLACES.map((place) => <option key={place}>{place}</option>)}
        </select>
      </label>
      <button type="button" className="rounded bg-orange-500 px-4 py-2 font-semibold text-slate-950" disabled={busy} onClick={() => void requestQuote()}>
        Get server segment quote
      </button>
      {quote ? (
        <section className="rounded border border-white/15 p-4 text-sm">
          <p>Server total: {segmentQuote?.total_gnf ?? "—"} GNF</p>
          <p>Definitive fare: {segmentQuote?.definitive === true ? "yes" : "no"}</p>
          <p>Commercial booking: {quote.commercial_booking === true ? "open" : "closed"}</p>
          <button type="button" className="mt-3 rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-950" disabled={busy || quote.commercial_booking !== true} onClick={() => void confirmQuote()}>
            Reserve this quoted route
          </button>
        </section>
      ) : null}
      {message ? <p className="text-sm text-amber-200">{message}</p> : null}
      <section className="space-y-2 text-sm">
        <h2 className="font-semibold">Your XL bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-slate-300">No booking is listed until the server returns your own rows. A quote is not a booking.</p>
        ) : null}
        {bookings.map((booking) => (
          <p key={String(booking.id)}>
            {booking.status ?? "booking"} · {booking.total_gnf ?? "—"} {booking.currency ?? "GNF"}
          </p>
        ))}
      </section>
      <p className="text-sm">
        <Link className="text-orange-300" href="/auth/sign-in?next=%2Fclient%2Ftaxi-xl">Sign in</Link>
        {" · "}
        <Link className="text-orange-300" href="/client/taxi">Taxi Standard</Link>
      </p>
    </main>
  );
}
