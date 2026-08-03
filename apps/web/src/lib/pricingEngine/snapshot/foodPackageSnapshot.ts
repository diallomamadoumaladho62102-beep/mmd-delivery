/**
 * In-process + optional DB Quote Snapshot store (Phase 3+ Food/Package/Ride).
 * Snapshots are immutable SoT after engine charge selection.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICING_ENGINE_ALGORITHM_SEMVER } from "../engine/assembleQuote";
import type { ComparableQuote } from "../shadow/comparableQuote";
import type { ChargePath } from "../flagTypes";

export type CutoverQuoteService = "food" | "package" | "ride" | "marketplace";

export type FoodPackageQuoteSnapshotRecord = {
  snapshotId: string;
  service: CutoverQuoteService;
  chargePath: ChargePath;
  currency: string;
  countryCode: string;
  customerTotalCents: number;
  pricingVersion: string;
  algorithmSemver: string;
  legacyVersion: string;
  engineVersion: string;
  quote: ComparableQuote;
  canaryKey: string | null;
  createdAt: string;
};

const memory: FoodPackageQuoteSnapshotRecord[] = [];
const MAX_MEMORY = 2000;

export function buildFoodPackageQuoteSnapshot(input: {
  service: CutoverQuoteService;
  chargePath: ChargePath;
  countryCode: string;
  quote: ComparableQuote;
  canaryKey?: string | null;
}): FoodPackageQuoteSnapshotRecord {
  const createdAt = new Date().toISOString();
  const phaseLabel =
    input.service === "marketplace"
      ? "phase5"
      : input.service === "ride"
        ? "phase4"
        : "phase3";
  return {
    snapshotId: randomUUID(),
    service: input.service,
    chargePath: input.chargePath,
    currency: input.quote.currency,
    countryCode: String(input.countryCode || "").toUpperCase() || "US",
    customerTotalCents: input.quote.customerTotalCents,
    pricingVersion: `${phaseLabel}-${input.service}`,
    algorithmSemver: PRICING_ENGINE_ALGORITHM_SEMVER,
    legacyVersion: input.quote.legacyVersion,
    engineVersion: input.quote.engineVersion,
    quote: input.quote,
    canaryKey: input.canaryKey ?? null,
    createdAt,
  };
}

export function rememberQuoteSnapshot(
  record: FoodPackageQuoteSnapshotRecord
): void {
  memory.push(record);
  while (memory.length > MAX_MEMORY) memory.shift();
}

export function getRememberedQuoteSnapshots(): FoodPackageQuoteSnapshotRecord[] {
  return [...memory];
}

export function clearRememberedQuoteSnapshotsForTests(): void {
  memory.length = 0;
}

export async function persistQuoteSnapshot(input: {
  record: FoodPackageQuoteSnapshotRecord;
  supabaseAdmin?: SupabaseClient | null;
}): Promise<boolean> {
  rememberQuoteSnapshot(input.record);
  if (!input.supabaseAdmin) return false;
  try {
    const { error } = await input.supabaseAdmin
      .from("pricing_quote_snapshots")
      .insert({
        snapshot_id: input.record.snapshotId,
        service: input.record.service,
        charge_path: input.record.chargePath,
        currency: input.record.currency,
        country_code: input.record.countryCode,
        customer_total_cents: input.record.customerTotalCents,
        pricing_version: input.record.pricingVersion,
        algorithm_semver: input.record.algorithmSemver,
        legacy_version: input.record.legacyVersion,
        engine_version: input.record.engineVersion,
        canary_key_hash: input.record.canaryKey
          ? input.record.canaryKey.slice(0, 8)
          : null,
        quote_payload: input.record.quote,
        created_at: input.record.createdAt,
      });
    return !error;
  } catch {
    return false;
  }
}
