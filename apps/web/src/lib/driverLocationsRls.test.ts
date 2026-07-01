import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260720120000_driver_locations_participant_read.sql",
);

const sql = fs.readFileSync(migrationPath, "utf8");

const requiredSnippets = [
  "can_read_driver_location",
  "driver_locations_select_participants",
  "is_active_order_for_tracking",
  "is_active_delivery_request_for_tracking",
  "is_active_taxi_ride_for_tracking",
  "order_participant_ids",
  "delivery_request_participant_ids",
  "taxi_ride_participant_ids",
  "is_staff_user",
  "for select",
  "to authenticated",
];

for (const snippet of requiredSnippets) {
  assert(sql.includes(snippet), `migration missing: ${snippet}`);
}

assert(
  !sql.includes("using (true)"),
  "migration must not grant blanket read access",
);

assert(
  sql.includes("p_driver_id = auth.uid()"),
  "driver self-read must remain",
);

console.log("driverLocationsRls tests passed");
