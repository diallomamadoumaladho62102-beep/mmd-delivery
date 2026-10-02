import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverIntegrityEntityType } from "./types";

/** Merge persisted reassignment exclusions into a dispatch/accept deny set. */
export async function mergeReassignmentExclusions(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType,
  entityId: string,
  into: Set<string>
): Promise<void> {
  const { data } = await supabase
    .from("driver_integrity_reassignment_exclusions")
    .select("driver_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  for (const row of data ?? []) {
    const id = String((row as { driver_id?: unknown }).driver_id ?? "").trim();
    if (id) into.add(id);
  }
}
