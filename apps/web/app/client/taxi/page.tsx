"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MapboxAddressField, { type GeocodedAddress } from "@/components/client/MapboxAddressField";
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

const emptyAddress: GeocodedAddress = { label: "", latitude: null, longitude: null };

function coords(point: GeocodedAddress) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    ? { lat: point.latitude, lng: point.longitude }
    : null;
}

export default function WebTaxiPage() {
  const [pickup, setPickup] = useState<GeocodedAddress>(emptyAddress);
  const [dropoff, setDropoff] = useState<GeocodedAddress>(emptyAddress);
  const [countryCode, setCountryCode] = useState("US");
  const [vehicleClass, setVehicleClass] = useState("standard");
  const [quote, setQuote] = useState<QuoteBody | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [historyState, setHistoryState] = useState<"unknown" | "signed_out" | "ready">("unknown");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [cancelWarning, setCancelWarning] = useState<string | null>(null);

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

  function tripBody() {
    const pickupPoint = coords(pickup);
    const dropoffPoint = coords(dropoff);
    return {
      pickupAddress: pickup.label,
      dropoffAddress: dropoff.label,
      ...(pickupPoint ? { pickupLat: pickupPoint.lat, pickupLng: pickupPoint.lng } : {}),
      ...(dropoffPoint ? { dropoffLat: dropoffPoint.lat, dropoffLng: dropoffPoint.lng } : {}),
      countryCode,
      vehicleClass,
      passengerCount: 1,
    };
  }

  function showResultError(result: { body: Record<string, unknown> }, fallback: string) {
    setMessage(result.body.error === "network_error"
      ? "Network error. Check your connection and try again."
      : String(result.body.error ?? result.body.message ?? fallback));
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage("This browser does not provide a location.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    }).catch(() => null);
    if (!position) {
      setBusy(false);
      setMessage("Location permission was denied or timed out.");
      return;
    }
    const result = await webTaxiFetch("/api/mapbox/reverse", {
      method: "POST",
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      showResultError(result, "Location lookup failed");
      return;
    }
    const label = String(result.body.fullAddress ?? "");
    const latitude = Number(result.body.latitude);
    const longitude = Number(result.body.longitude);
    if (!label) {
      setMessage("The server did not return an address.");
      return;
    }
    setPickup({
      label,
      latitude: Number.isFinite(latitude) ? latitude : position.coords.latitude,
      longitude: Number.isFinite(longitude) ? longitude : position.coords.longitude,
    });
  }

  async function requestQuote() {
    if (!pickup.label.trim() || !dropoff.label.trim()) {
      setMessage("Enter a pickup and a destination.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setQuote(null);
    const result = await webTaxiFetch("/api/taxi/rides/quote", {
      method: "POST",
      body: JSON.stringify(tripBody()),
    });
    setBusy(false);
    if (result.status === 401) {
      setMessage("Sign in to request a server quote.");
      return;
    }
    if (!result.ok) {
      showResultError(result, "Quote failed");
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
        ...tripBody(),
        expectedQuoteTotalCents: total,
        paymentMethod: cash ? "cash" : "card",
      }),
    });
    setBusy(false);
    if (!result.ok) {
      showResultError(result, "Confirmation failed");
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
    if (rideId) {
      setRides((current) => [{ id: rideId, status: "requested", pickup_address: pickup.label, dropoff_address: dropoff.label, total_cents: total, currency: quote.quote.currency }, ...current]);
    }
  }

  async function refreshRide(rideId: string) {
    setBusy(true);
    setMessage(null);
    const result = await webTaxiFetch(`/api/taxi/rides/${rideId}`);
    setBusy(false);
    if (!result.ok) {
      showResultError(result, "Status refresh failed");
      return;
    }
    const ride = result.body.ride;
    if (!ride || typeof ride !== "object") return;
    const row = ride as RideRow;
    setRides((current) => current.map((item) => item.id === rideId ? {
      ...item,
      status: typeof row.status === "string" ? row.status : item.status,
      pickup_address: typeof row.pickup_address === "string" ? row.pickup_address : item.pickup_address,
      dropoff_address: typeof row.dropoff_address === "string" ? row.dropoff_address : item.dropoff_address,
      total_cents: typeof row.total_cents === "number" ? row.total_cents : item.total_cents,
      currency: typeof row.currency === "string" ? row.currency : item.currency,
    } : item));
  }

  async function previewCancel(rideId: string) {
    setBusy(true);
    setCancelWarning(null);
    const result = await webTaxiFetch("/api/taxi/rides/cancel", {
      method: "POST",
      body: JSON.stringify({ taxi_ride_id: rideId, preview: true }),
    });
    setBusy(false);
    if (!result.ok) {
      showResultError(result, "Cancellation preview failed");
      return;
    }
    const fee = result.body.fee;
    const warning = fee && typeof fee === "object" && fee !== null && "warning" in fee
      ? String((fee as { warning?: unknown }).warning ?? "")
      : "";
    setCancelId(rideId);
    setCancelWarning(warning || "The server returned a cancellation preview. Confirming will cancel this ride.");
  }

  async function confirmCancel() {
    if (!cancelId || !cancelReason) {
      setMessage("Choose a cancellation reason.");
      return;
    }
    setBusy(true);
    const result = await webTaxiFetch("/api/taxi/rides/cancel", {
      method: "POST",
      body: JSON.stringify({
        taxi_ride_id: cancelId,
        reason_code: cancelReason,
        reason_detail: cancelNote,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      showResultError(result, "Cancellation failed");
      return;
    }
    setRides((current) => current.map((item) => item.id === cancelId ? { ...item, status: "canceled" } : item));
    setCancelId(null);
    setCancelWarning(null);
    setMessage("The server recorded the cancellation.");
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
      <div className="block text-sm">
        Pickup
        <MapboxAddressField value={pickup.label} onChange={setPickup} placeholder="Search a pickup address" />
        <button type="button" className="mt-2 text-orange-300" disabled={busy} onClick={() => void useMyLocation()}>
          Use my location
        </button>
      </div>
      <div className="block text-sm">
        Destination
        <MapboxAddressField value={dropoff.label} onChange={setDropoff} placeholder="Search a destination" />
      </div>
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
      <button type="button" className="rounded bg-orange-500 px-4 py-2 font-semibold text-slate-950" disabled={busy || !pickup.label.trim() || !dropoff.label.trim()} onClick={() => void requestQuote()}>
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
        {rides.map((ride) => {
          const rideId = String(ride.id ?? "");
          const closed = ride.status === "completed" || ride.status === "canceled" || ride.status === "cancelled";
          return (
            <div key={rideId} className="rounded border border-white/10 p-3">
              <p>
                <Link className="text-orange-300" href={`/taxi/receipt/${rideId}`}>{ride.status ?? "ride"}</Link>
                {" · "}
                {ride.pickup_address ?? "—"} → {ride.dropoff_address ?? "—"}
                {" · "}
                {ride.total_cents ?? "—"} {ride.currency ?? ""}
              </p>
              <button type="button" className="mr-3 mt-2 text-orange-300" disabled={busy} onClick={() => void refreshRide(rideId)}>
                Refresh status
              </button>
              {closed ? null : (
                <button type="button" className="mt-2 text-orange-300" disabled={busy} onClick={() => void previewCancel(rideId)}>
                  Preview cancellation
                </button>
              )}
              {cancelId === rideId ? (
                <div className="mt-2 space-y-2">
                  <p>{cancelWarning}</p>
                  <label className="block">
                    Reason
                    <select className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)}>
                      <option value="">Choose a reason</option>
                      <option value="driver_not_moving">Driver is not moving</option>
                      <option value="driver_too_late">Driver is too late</option>
                      <option value="driver_concerning_behavior">Concerning behavior</option>
                      <option value="passenger_feels_unsafe">I feel unsafe</option>
                      <option value="pickup_location_problem">Pickup location problem</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="block">
                    Note
                    <input className="mt-1 w-full rounded border border-white/20 bg-slate-900 px-3 py-2" value={cancelNote} onChange={(event) => setCancelNote(event.target.value)} />
                  </label>
                  <button type="button" className="rounded bg-rose-500 px-3 py-2 font-semibold text-white" disabled={busy || !cancelReason} onClick={() => void confirmCancel()}>
                    Confirm cancellation
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
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
