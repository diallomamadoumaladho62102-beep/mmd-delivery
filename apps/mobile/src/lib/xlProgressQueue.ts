import {
  acknowledgeXlProgress,
  enqueueXlProgress,
  pendingXlProgress,
  rejectXlProgress,
  type XlQueuedProgress,
} from "../../../../shared/xlSegmentProgress";

const KEY = "mmd.xl.progress.v1";

export type XlProgressStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export async function readXlProgress(storage: XlProgressStorage): Promise<XlQueuedProgress[]> {
  const raw = await storage.getItem(KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as XlQueuedProgress[]) : [];
}

/** Stores one local event. A repeated event id does not create a second row. */
export async function queueXlProgress(storage: XlProgressStorage, event: XlQueuedProgress) {
  const current = await readXlProgress(storage);
  const next = enqueueXlProgress(current, event);
  await storage.setItem(KEY, JSON.stringify(next.events));
  return next;
}

export async function flushXlProgress(
  storage: XlProgressStorage,
  send: (
    pending: XlQueuedProgress[],
  ) => Promise<
    | {
        ok: true;
        acks: Array<{ eventId: string; receivedAtMs: number; applied: boolean }>;
        rejected?: Array<{ eventId: string; error: string }>;
      }
    | { ok: false }
  >,
) {
  const current = await readXlProgress(storage);
  const pending = pendingXlProgress(current);
  if (pending.length === 0) return { synced: 0, rejected: 0 };
  let result: Awaited<ReturnType<typeof send>>;
  try {
    result = await send(pending);
  } catch {
    return { synced: 0, rejected: 0 };
  }
  if (!result.ok || !Array.isArray(result.acks)) return { synced: 0, rejected: 0 };
  const rejected = result.rejected ?? [];
  if (!Array.isArray(rejected)) return { synced: 0, rejected: 0 };
  const rejectedIds = new Set(rejected.map((item) => item.eventId));
  const acks = result.acks.filter((ack) => !rejectedIds.has(ack.eventId));
  const settled = rejectXlProgress(acknowledgeXlProgress(current, acks), rejected);
  await storage.setItem(KEY, JSON.stringify(settled));
  return { synced: acks.length, rejected: rejected.length };
}
