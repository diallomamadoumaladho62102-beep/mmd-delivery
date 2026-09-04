import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname);

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const driverMap = read("../screens/DriverMapScreen.tsx");
assert(driverMap.includes("buildStableRouteVersion"), "driver map uses stable route version");
assert(driverMap.includes("instructionKey"), "voice uses instruction keys");
assert(driverMap.includes("useSmoothedDriverMarker"), "driver map animates vehicle marker");
assert(driverMap.includes("stopNavigationVoice"), "reroute stops voice and resets ledger");

const taxiTracking = read("../screens/taxi/TaxiRideTrackingScreen.tsx");
assert(taxiTracking.includes("useSmoothedDriverMarker"), "customer tracking smooths driver");
assert(taxiTracking.includes("joinDriverBanner"), "join driver CTA when arrived");

const taxiPush = read("./taxiPushEvents.ts");
assert(taxiPush.includes("driver_en_route"), "client handles driver en route push");

const liveDriverHook = read("../hooks/useLiveDriverLocation.ts");
assert(liveDriverHook.includes("unsubscribeSupabaseChannel"), "live driver unsubscribes");

console.log("navigationDriverCustomer.regression.test.ts — PASS");
