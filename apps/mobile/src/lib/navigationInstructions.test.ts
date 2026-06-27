import {
  buildNavigationInstruction,
  extractStreetName,
  pickCurrentStep,
  pickNextStep,
} from "./navigationInstructions";
import { formatManeuverDistanceLabel } from "./navigationLocale";
import type { NavigationRouteStep } from "./navigationService";

const steps: NavigationRouteStep[] = [
  { instruction: "Turn right onto Clarendon Road", distanceMeters: 2800, durationSeconds: 300 },
  { instruction: "Keep left onto Flatbush Ave", distanceMeters: 650, durationSeconds: 90 },
  { instruction: "Arrive at destination", distanceMeters: 120, durationSeconds: 30 },
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const current = pickCurrentStep(steps, 2900);
assert(current?.instruction === "Turn right onto Clarendon Road", "current step");

const next = pickNextStep(steps, 2900);
assert(next?.instruction === "Keep left onto Flatbush Ave", "next step");

const instruction = buildNavigationInstruction({
  remainingMeters: 2900,
  stage: "dropoff",
  steps,
  locale: "en",
});

assert(
  instruction.secondaryTitle === "Keep left onto Flatbush Ave",
  "secondary instruction title",
);

assert(
  formatManeuverDistanceLabel(800, "en") === "In 0.5 mi",
  "english maneuver distance",
);

assert(
  formatManeuverDistanceLabel(500, "fr") === "Dans 500 m",
  "french maneuver distance",
);

assert(
  extractStreetName("Tournez à gauche sur Junius St") === "Junius St",
  "street name extraction",
);

console.log("navigationInstructions tests passed");
