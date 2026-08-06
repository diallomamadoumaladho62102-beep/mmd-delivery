"use client";

import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  driverOnlineBadge,
  formatRideDateParts,
  formatRideMoney,
  partyDisplayName,
  paymentStatusBadge,
  rideStatusBadge,
  shortRideId,
  type AdminTaxiRideListItem,
  type TaxiBadgeTone,
} from "@/lib/adminTaxiRideDisplay";
import TaxiRideActionsBar from "./TaxiRideActionsBar";
import TaxiRideActionsMenu from "./TaxiRideActionsMenu";
import TaxiRideAvatar from "./TaxiRideAvatar";
import TaxiRideBadge from "./TaxiRideBadge";
import TaxiRideStatusStepper from "./TaxiRideStatusStepper";

function timeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const { date, time } = formatRideDateParts(iso);
  if (date === "—") return null;
  return `${date} · ${time}`;
}

function TaxiRideOpsCard({ ride }: { ride: AdminTaxiRideListItem }) {
  const status = rideStatusBadge(ride.status);
  const payment = paymentStatusBadge(ride.payment_status);
  const refund = ride.refund_status
    ? paymentStatusBadge(ride.refund_status)
    : null;
  const { date, time } = formatRideDateParts(ride.created_at);
  const hasClient = Boolean(ride.client?.id || ride.client_user_id);
  const hasDriver = Boolean(ride.driver?.id || ride.driver_id);
  const clientName = hasClient
    ? partyDisplayName(ride.client, ride.client_user_id?.slice(0, 8) || "Client")
    : null;
  const driverName = hasDriver
    ? partyDisplayName(ride.driver, ride.driver_id?.slice(0, 8) || "Driver")
    : null;
  const online = hasDriver ? driverOnlineBadge(ride.driver_is_online) : null;

  const pickupAddress = String(ride.pickup_address ?? "").trim() || null;
  const dropoffAddress = String(ride.dropoff_address ?? "").trim() || null;
  const pickupCity = String(ride.pickup_city ?? "").trim() || null;

  const vehicle = ride.vehicle;
  const hasVehicle = Boolean(
    vehicle &&
      (vehicle.photo_url ||
        vehicle.make ||
        vehicle.model ||
        vehicle.year ||
        vehicle.color ||
        vehicle.plate ||
        vehicle.vehicle_type)
  );

  const lifecycle = (
    [
      ["Created", timeLabel(ride.created_at)],
      ["Accepted", timeLabel(ride.accepted_at)],
      ["Arrived", timeLabel(ride.driver_arrived_at)],
      ["Picked up", timeLabel(ride.started_at)],
      ["Completed", timeLabel(ride.completed_at)],
    ] as const
  ).filter(([, v]) => Boolean(v));

  return (
    <article
      id={`ride-${ride.id}`}
      className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/taxi-rides/${ride.id}`}
              className="inline-flex h-11 min-h-11 items-center font-semibold tracking-tight text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              #{shortRideId(ride.id)}
            </Link>
            <TaxiRideBadge label={status.label} tone={status.tone} />
            <TaxiRideBadge
              label={payment.label}
              tone={(payment.tone === "orange" ? "yellow" : payment.tone) as TaxiBadgeTone}
            />
            {ride.vehicle_class ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {ride.vehicle_class}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {date} · {time}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <div className="text-base font-semibold text-slate-900">
              {formatRideMoney(ride.total_cents, ride.currency ?? "USD")}
            </div>
            <div className="mt-0.5 flex flex-wrap justify-end gap-x-2 text-[11px] text-slate-500">
              {ride.currency ? <span>{ride.currency}</span> : null}
              {ride.distance_miles != null ? (
                <span>{ride.distance_miles.toFixed(1)} mi</span>
              ) : null}
              {ride.duration_minutes != null ? (
                <span>{ride.duration_minutes} min</span>
              ) : null}
              {ride.next_ride_eta_minutes != null ? (
                <span>ETA {ride.next_ride_eta_minutes} min</span>
              ) : null}
            </div>
          </div>
          <TaxiRideActionsMenu ride={ride} />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">Payment</span>
          <TaxiRideBadge
            label={payment.label}
            tone={(payment.tone === "orange" ? "yellow" : payment.tone) as TaxiBadgeTone}
          />
          {refund && String(ride.refund_status ?? "").trim() ? (
            <TaxiRideBadge
              label={`Refund: ${String(ride.refund_status)}`}
              tone={(refund.tone === "orange" ? "yellow" : refund.tone) as TaxiBadgeTone}
            />
          ) : null}
        </div>
        <div className="mt-1 text-slate-600">
          Amount{" "}
          <span className="font-semibold text-slate-900">
            {formatRideMoney(ride.total_cents, ride.currency ?? "USD")}
          </span>
          {ride.currency ? ` · ${ride.currency}` : ""}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <TaxiRideAvatar name={clientName ?? "?"} src={ride.client?.avatar_url} size={44} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Client
            </div>
            {clientName ? (
              <>
                <div className="truncate text-sm font-medium text-slate-900">{clientName}</div>
                {ride.client?.email ? (
                  <div className="truncate text-[11px] text-slate-500">{ride.client.email}</div>
                ) : null}
                {ride.client?.phone ? (
                  <div className="truncate text-[11px] text-slate-500">{ride.client.phone}</div>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-slate-500">No client data</div>
            )}
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2.5">
          <TaxiRideAvatar name={driverName ?? "?"} src={ride.driver?.avatar_url} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Driver
              </div>
              {online ? <TaxiRideBadge label={online.label} tone={online.tone} /> : null}
            </div>
            {driverName ? (
              <>
                <div className="truncate text-sm font-medium text-slate-900">{driverName}</div>
                {ride.driver?.phone ? (
                  <div className="truncate text-[11px] text-slate-500">{ride.driver.phone}</div>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-slate-500">No driver assigned</div>
            )}
          </div>
        </div>
      </div>

      {(pickupAddress || dropoffAddress) && (
        <div
          className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-800"
          aria-label="Trip locations"
        >
          {pickupAddress ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Pickup
              </div>
              <div className="mt-0.5 font-medium leading-snug text-slate-900">
                {pickupAddress}
              </div>
              {pickupCity ? (
                <div className="mt-0.5 text-xs text-slate-500">{pickupCity}</div>
              ) : null}
            </div>
          ) : null}
          {pickupAddress && dropoffAddress ? (
            <div className="text-center text-xs font-semibold text-slate-400" aria-hidden>
              ↓
            </div>
          ) : null}
          {dropoffAddress ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Destination
              </div>
              <div className="mt-0.5 font-medium leading-snug text-slate-900">
                {dropoffAddress}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {hasVehicle && vehicle ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <div className="grid grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)]">
            <div className="relative h-24 bg-slate-100 sm:h-full sm:min-h-[6.5rem]">
              {vehicle.photo_url ? (
                <Image
                  src={vehicle.photo_url}
                  alt=""
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full min-h-[6.5rem] items-center justify-center text-[11px] text-slate-400">
                  Vehicle
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 text-xs">
              {(
                [
                  ["Type", vehicle.vehicle_type],
                  ["Make", vehicle.make],
                  ["Model", vehicle.model],
                  ["Year", vehicle.year != null ? String(vehicle.year) : null],
                  ["Color", vehicle.color],
                  ["Plate", vehicle.plate],
                ] as const
              )
                .filter(([, v]) => Boolean(v))
                .map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">
                      {label}
                    </div>
                    <div className="truncate font-medium text-slate-900">{value}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {lifecycle.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {lifecycle.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
              <span className="font-semibold text-slate-500">{label}</span>
              <span className="ml-1.5 text-slate-800">{value}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <TaxiRideStatusStepper ride={ride} />
      </div>

      <div className="mt-4">
        <TaxiRideActionsBar ride={ride} />
      </div>
    </article>
  );
}

export default memo(TaxiRideOpsCard);
