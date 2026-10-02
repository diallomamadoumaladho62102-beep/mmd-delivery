import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverIntegrityEntityType } from "./types";

export const DRIVER_INTEGRITY_SCAN_PAGE_SIZE = 25;

export type ScanCursor = {
  lastAcceptedAt: string | null;
  lastId: string | null;
};

export async function loadScanCursor(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType
): Promise<ScanCursor> {
  const { data } = await supabase
    .from("driver_integrity_scan_cursors")
    .select("last_accepted_at,last_id")
    .eq("entity_type", entityType)
    .maybeSingle();
  return {
    lastAcceptedAt: data?.last_accepted_at ? String(data.last_accepted_at) : null,
    lastId: data?.last_id ? String(data.last_id) : null,
  };
}

export async function saveScanCursor(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType,
  cursor: ScanCursor
): Promise<void> {
  await supabase.from("driver_integrity_scan_cursors").upsert(
    {
      entity_type: entityType,
      last_accepted_at: cursor.lastAcceptedAt,
      last_id: cursor.lastId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity_type" }
  );
}

