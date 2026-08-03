/**
 * In-memory shadow journal (Phase 2) — complements DB table when unavailable.
 * Never used for charging. Cap keeps memory bounded.
 */

import type { ShadowCompareReport } from "./comparableQuote";

const MAX_ENTRIES = 2000;

export type ShadowJournalEntry = {
  compareId: string;
  at: string;
  service: string;
  equal: boolean;
  diffCents: number;
  legacyTotalCents: number;
  engineTotalCents: number;
  legacyVersion: string;
  engineVersion: string;
  legacyLatencyMs: number;
  engineLatencyMs: number;
  fieldDiffCount: number;
};

const journal: ShadowJournalEntry[] = [];

export function appendShadowJournal(report: ShadowCompareReport): void {
  journal.push({
    compareId: report.compareId,
    at: report.at,
    service: report.service,
    equal: report.equal,
    diffCents: report.diffCents,
    legacyTotalCents: report.legacy.customerTotalCents,
    engineTotalCents: report.engine.customerTotalCents,
    legacyVersion: report.legacy.legacyVersion,
    engineVersion: report.engine.engineVersion,
    legacyLatencyMs: report.legacyLatencyMs,
    engineLatencyMs: report.engineLatencyMs,
    fieldDiffCount: report.fieldDiffs.length,
  });
  while (journal.length > MAX_ENTRIES) {
    journal.shift();
  }
}

export function getShadowJournalEntries(): ShadowJournalEntry[] {
  return [...journal];
}

export function clearShadowJournalForTests(): void {
  journal.length = 0;
}

export function summarizeShadowJournal(): {
  entries: number;
  equal: number;
  diff: number;
  byService: Record<string, { equal: number; diff: number }>;
} {
  const byService: Record<string, { equal: number; diff: number }> = {};
  let equal = 0;
  let diff = 0;
  for (const e of journal) {
    if (e.equal) equal += 1;
    else diff += 1;
    const bucket = byService[e.service] ?? { equal: 0, diff: 0 };
    if (e.equal) bucket.equal += 1;
    else bucket.diff += 1;
    byService[e.service] = bucket;
  }
  return { entries: journal.length, equal, diff, byService };
}
