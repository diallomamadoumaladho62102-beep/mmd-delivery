"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { webTaxiFetch } from "@/lib/webTaxiSession";

type QuoteBody = {
  quote?: {
    total_cents?: number;
    currency?: string;
    charge_path?: string;
    distance_km?: number;
    duration_minutes?: number;
  };
  route?: { distanceMiles?: number; durationMinutes?: number };
  error?: string;
};

type RideRow = {
  id?: string;
  status?: string;
  pickup_address?: string;
  dropoff_address?: string;
  total_cents?: number;
  currency?: string;
};

export default function WebTaxiPage() {
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [vehicleClass, setVehicleClass] = useState("standard");
  const [quote, setQuote] = useState<QuoteBody | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [historyState, setHistoryState] = useState<"unknown" | "signed_out" | "ready">("unknown");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void webTaxiFetch("/api/taxi/rides/mine").then((result) => {
      if (!mounted) return;
      if (result.status === 401) {
        setHistoryState("signed_out");
        return;
      }
      if (!result.ok) return;
      const rows = Array.isArray(result.body.rides) ? result.body.rides : [];
      setRides(rows.filter((ride) => ride && typeof ride === "object" && "id" in ride).slice(0, 8) as RideRow[]);
      setHistoryState("ready");
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function requestQuote() {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMessage("Enter a pickup and a destination.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setQuote(null);
    const result = await webTaxiFetch("/api/taxi/rides/quote", {
      method: "POST",
      body: JSON.stringify({
        pickupAddress,
        dropoffAddress,
        countryCode,
        vehicleClass,
        passengerCount: 1,
      }),
    });
    setBusy(false);
    if (result.status === 401) {
      setMessage("Sign in to request a server quote.");
      return;
    }
    if (!result.ok) {
      setMessage(String(result.body.error ?? "Quote failed"));
      return;
    }
    setQuote(result.body as QuoteBody);
  }

  async function confirmQuote() {
    if (!quote?.quote) return;
    setBusy(true);
    setMessage(null);
    const total = quote.quote.total_cents;
    const cash = quote.quote.charge_path === "guinea_cash" || quote.quote.currency === "GNF";
    const path = cash
      ? "/api/taxi/rides/create"
      : "/api/stripe/client/create-taxi-quote-checkout-session";
    const result = await webTaxiFetch(path, {
      method: "POST",
      body: JSON.stringify({
        pickupAddress,
        dropoffAddress,
        countryCode,
        vehicleClass,
        passengerCount: 1,
        expectedQuoteTotalCents: total,
        paymentMethod: cash ? "cash" : "card",
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(String(result.body.error ?? "Confirmation failed"));
      return;
    }
    const url = typeof result.body.url === "string" ? result.body.url : "";
    if (url) {
      window.location.assign(url);
      return;
    }
    const rideId = String(
      (result.body.ride as { id?: string } | undefined)?.id ?? result.body.id ?? "",
    );
    setMessage(rideId ? `Reservation recorded: ${rideId}` : "The server accepted the request.");
  }

  const shown = quote?.quote;
  const distanceLabel =
    shown?.distance_km != null
      ? `${shown.distance_km} km`
      : quote?.route?.distanceMiles != null
        ? `${quote.route.distanceMiles} mi`
        : "—";
  const durationLabel =
    shown?.duration_minutes ?? quote?.route?.durationMinutes ?? "—";

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6 text-slate-100">
      <h1 className="text-2xl font-bold">Book a taxi on the web</h1>
      <p className="text-sm text-slate-300">
        The server calculates the fare. This page does not set Taxi Standard or Taxi XL prices.
      </p>
      <label className="block text-sm">
        Pickup
        <input className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={pickupAddress} onChange={(event) => setPickupAddress(event.target.value)} />
      </label>
      <label className="block text-sm">
        Destination
        <input className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={dropoffAddress} onChange={(event) => setDropoffAddress(event.target.value)} />
      </label>
      <label className="block text-sm">
        Market
        <select className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="BE">Belgium</option>
          <option value="GN">Guinea</option>
        </select>
      </label>
      <label className="block text-sm">
        Vehicle
        <select className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={vehicleClass} onChange={(event) => setVehicleClass(event.target.value)}>
          <option value="standard">Standard</option>
          <option value="comfort">Comfort</option>
          <option value="xl">XL</option>
          <option value="motorcycle">Motorcycle (Guinea)</option>
        </select>
      </label>
      <button type="button" className="rounded bg-orange-500 px-4 py-2 font-semibold text-slate-950" disabled={busy || !pickupAddress.trim() || !dropoffAddress.trim()} onClick={() => void requestQuote()}>
        Get server quote
      </button>
      {shown ? (
        <section className="rounded border border-white/15 p-4 text-sm">
          <p>Total from server: {shown.total_cents} {shown.currency ?? (shown.charge_path === "guinea_cash" ? "GNF" : "")}</p>
          <p>Distance: {distanceLabel}</p>
          <p>Duration: {durationLabel === "—" ? "—" : `${durationLabel} min`}</p>
          <p>Payment path: {shown.charge_path ?? "card checkout"}</p>
          <button type="button" className="mt-3 rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-950" disabled={busy} onClick={() => void confirmQuote()}>
            Confirm this server quote
          </button>
        </section>
      ) : null}
      {message ? <p className="text-sm text-amber-200">{message}</p> : null}
      <section className="space-y-2 text-sm">
        <h2 className="font-semibold">Your taxi rides</h2>
        {historyState === "signed_out" ? <p className="text-slate-300">Sign in to load your rides.</p> : null}
        {historyState === "ready" && rides.length === 0 ? <p className="text-slate-300">The server returned no rides for this account.</p> : null}
        {rides.map((ride) => (
          <p key={String(ride.id)}>
            <Link className="text-orange-300" href={`/taxi/receipt/${ride.id}`}>{ride.status ?? "ride"}</Link>
            {" · "}
            {ride.pickup_address ?? "—"} → {ride.dropoff_address ?? "—"}
            {" · "}
            {ride.total_cents ?? "—"} {ride.currency ?? ""}
          </p>
        ))}
      </section>
      <p className="text-sm">
        <Link className="text-orange-300" href="/auth/sign-in?next=%2Fclient%2Ftaxi">Sign in</Link>
        {" · "}
        <Link className="text-orange-300" href="/client/taxi-xl">Taxi XL</Link>
        {" · "}
        <Link className="text-orange-300" href="/orders/new">Food</Link>
        {" · "}
        <Link className="text-orange-300" href="/orders/create">Packages</Link>
      </p>
    </main>
  );
}
