import {
  xlProgressEventReliable,
  type XlProgressEvent,
  type XlProgressKind,
  type XlQueuedProgress,
} from "./xlSegmentProgress";

export type XlProgressAck = { eventId: string; receivedAtMs: number; applied: boolean };
export type XlProgressRejection = { eventId: string; error: string };

/** The phone sends these fields. A driver id in the body is not part of the contract. */
export function xlProgressSyncEvents(events: XlQueuedProgress[]) {
  return events.map((event) => ({
    event_id: event.eventId,
    departure_id: event.departureId,
    kind: event.kind,
    stop_index: event.stopIndex,
    lat: event.lat,
    lng: event.lng,
    captured_at: new Date(event.capturedAtMs).toISOString(),
    reason: event.reason ?? null,
  }));
}

function progressKind(value: unknown): XlProgressKind | null {
  if (
    value === "gps" ||
    value === "stop_reached" ||
    value === "passenger_picked_up" ||
    value === "passenger_dropped_off" ||
    value === "progress_reconciled"
  ) {
    return value;
  }
  return null;
}

function finiteStoredCoord(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** One stored progress row, from PostgreSQL or from the accept function. */
export function xlProgressEventFromStoredRow(row: Record<string, unknown>): XlProgressEvent | null {
  const kind = progressKind(row.kind);
  const eventId = String(row.event_id ?? "");
  if (!kind || !eventId) return null;
  const receivedAtMs = Date.parse(String(row.received_at ?? ""));
  const capturedAtMs = Date.parse(String(row.captured_at ?? ""));
  const stopIndex = row.stop_index == null || row.stop_index === "" ? null : Number(row.stop_index);
  return {
    eventId,
    kind,
    stopIndex: Number.isSafeInteger(stopIndex) ? stopIndex : null,
    lat: finiteStoredCoord(row.lat),
    lng: finiteStoredCoord(row.lng),
    capturedAtMs,
    receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null,
    reason: row.reason == null ? null : String(row.reason),
  };
}

/**
 * Turns the accept-function payload into the HTTP body.
 * An event with an error is rejected. It is not acknowledged.
 */
export function xlProgressHttpBodyFromRpc(payload: {
  ok?: boolean;
  error?: string;
  events?: Array<Record<string, unknown>>;
}): { ok: true; acks: XlProgressAck[]; rejected: XlProgressRejection[] } | { ok: false; error: string } {
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "xl_progress_unverified") };
  if (!Array.isArray(payload.events)) return { ok: false, error: "xl_progress_unverified" };
  const acks: XlProgressAck[] = [];
  const rejected: XlProgressRejection[] = [];
  for (const row of payload.events) {
    if (row.error) {
      const eventId = String(row.event_id ?? "");
      if (!eventId) return { ok: false, error: "xl_progress_unverified" };
      rejected.push({ eventId, error: String(row.error) });
      continue;
    }
    const event = xlProgressEventFromStoredRow(row);
    if (!event || event.receivedAtMs == null) return { ok: false, error: "xl_progress_unverified" };
    acks.push({
      eventId: event.eventId,
      receivedAtMs: event.receivedAtMs,
      applied: xlProgressEventReliable(event),
    });
  }
  return { ok: true, acks, rejected };
}

/**
 * The phone accepts this shape only.
 * A missing list, a bad receipt, or the same id in both lists does not confirm the event.
 */
export function interpretXlProgressSyncResponse(payload: unknown):
  | { ok: true; acks: XlProgressAck[]; rejected: XlProgressRejection[] }
  | { ok: false } {
  if (!payload || typeof payload !== "object") return { ok: false };
  const body = payload as Record<string, unknown>;
  if (body.ok !== true || !Array.isArray(body.acks)) return { ok: false };
  if (body.rejected != null && !Array.isArray(body.rejected)) return { ok: false };
  const rejectedRows = Array.isArray(body.rejected) ? body.rejected : [];
  const rejected: XlProgressRejection[] = [];
  for (const row of rejectedRows) {
    if (!row || typeof row !== "object") return { ok: false };
    const item = row as Record<string, unknown>;
    if (typeof item.eventId !== "string" || !item.eventId || typeof item.error !== "string" || !item.error) {
      return { ok: false };
    }
    rejected.push({ eventId: item.eventId, error: item.error });
  }
  const rejectedIds = new Set(rejected.map((item) => item.eventId));
  const acks: XlProgressAck[] = [];
  for (const row of body.acks) {
    if (!row || typeof row !== "object") return { ok: false };
    const item = row as Record<string, unknown>;
    if (typeof item.eventId !== "string" || !item.eventId || typeof item.applied !== "boolean") return { ok: false };
    if (!Number.isSafeInteger(item.receivedAtMs)) return { ok: false };
    if (rejectedIds.has(item.eventId)) continue;
    acks.push({ eventId: item.eventId, receivedAtMs: item.receivedAtMs as number, applied: item.applied });
  }
  return { ok: true, acks, rejected };
}
