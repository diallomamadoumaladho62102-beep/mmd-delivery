import type { TimeInterval } from "./types";

export function clipInterval(
  interval: TimeInterval,
  windowStartMs: number,
  windowEndMs: number
): TimeInterval | null {
  const start = Math.max(interval.startedAtMs, windowStartMs);
  const end = Math.min(interval.endedAtMs, windowEndMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { startedAtMs: start, endedAtMs: end };
}

export function unionIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const valid = intervals
    .filter((row) => row.endedAtMs > row.startedAtMs)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
  if (valid.length === 0) return [];

  const out: TimeInterval[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i += 1) {
    const current = valid[i];
    const last = out[out.length - 1];
    if (current.startedAtMs <= last.endedAtMs) {
      last.endedAtMs = Math.max(last.endedAtMs, current.endedAtMs);
    } else {
      out.push({ ...current });
    }
  }
  return out;
}

export function subtractIntervals(
  source: TimeInterval[],
  subtract: TimeInterval[]
): TimeInterval[] {
  const base = unionIntervals(source);
  const cut = unionIntervals(subtract);
  const out: TimeInterval[] = [];

  for (const block of base) {
    let cursor = block.startedAtMs;
    for (const hole of cut) {
      if (hole.endedAtMs <= cursor) continue;
      if (hole.startedAtMs >= block.endedAtMs) break;
      if (hole.startedAtMs > cursor) {
        out.push({ startedAtMs: cursor, endedAtMs: Math.min(hole.startedAtMs, block.endedAtMs) });
      }
      cursor = Math.max(cursor, hole.endedAtMs);
      if (cursor >= block.endedAtMs) break;
    }
    if (cursor < block.endedAtMs) {
      out.push({ startedAtMs: cursor, endedAtMs: block.endedAtMs });
    }
  }
  return unionIntervals(out);
}

export function durationSeconds(intervals: TimeInterval[]): number {
  return unionIntervals(intervals).reduce((sum, row) => {
    return sum + Math.max(0, Math.floor((row.endedAtMs - row.startedAtMs) / 1000));
  }, 0);
}
