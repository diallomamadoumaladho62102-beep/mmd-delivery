/**
 * Cutover metrics (Food/Package/Ride/Marketplace) — in-process, no Stripe.
 */
export type CutoverMetricsSnapshot = {
  foodLegacy: number;
  foodEngine: number;
  foodFailOpen: number;
  packageLegacy: number;
  packageEngine: number;
  packageFailOpen: number;
  rideLegacy: number;
  rideEngine: number;
  rideFailOpen: number;
  marketplaceLegacy: number;
  marketplaceEngine: number;
  marketplaceFailOpen: number;
};

const state: CutoverMetricsSnapshot = {
  foodLegacy: 0,
  foodEngine: 0,
  foodFailOpen: 0,
  packageLegacy: 0,
  packageEngine: 0,
  packageFailOpen: 0,
  rideLegacy: 0,
  rideEngine: 0,
  rideFailOpen: 0,
  marketplaceLegacy: 0,
  marketplaceEngine: 0,
  marketplaceFailOpen: 0,
};

export function recordCutoverSelection(input: {
  service: "food" | "package" | "ride" | "marketplace";
  path: "legacy" | "engine" | "fail_open_legacy";
}): void {
  if (input.service === "food") {
    if (input.path === "engine") state.foodEngine += 1;
    else if (input.path === "fail_open_legacy") state.foodFailOpen += 1;
    else state.foodLegacy += 1;
    return;
  }
  if (input.service === "package") {
    if (input.path === "engine") state.packageEngine += 1;
    else if (input.path === "fail_open_legacy") state.packageFailOpen += 1;
    else state.packageLegacy += 1;
    return;
  }
  if (input.service === "ride") {
    if (input.path === "engine") state.rideEngine += 1;
    else if (input.path === "fail_open_legacy") state.rideFailOpen += 1;
    else state.rideLegacy += 1;
    return;
  }
  if (input.path === "engine") state.marketplaceEngine += 1;
  else if (input.path === "fail_open_legacy") state.marketplaceFailOpen += 1;
  else state.marketplaceLegacy += 1;
}

export function getCutoverMetricsSnapshot(): CutoverMetricsSnapshot {
  return { ...state };
}

export function resetCutoverMetricsForTests(): void {
  state.foodLegacy = 0;
  state.foodEngine = 0;
  state.foodFailOpen = 0;
  state.packageLegacy = 0;
  state.packageEngine = 0;
  state.packageFailOpen = 0;
  state.rideLegacy = 0;
  state.rideEngine = 0;
  state.rideFailOpen = 0;
  state.marketplaceLegacy = 0;
  state.marketplaceEngine = 0;
  state.marketplaceFailOpen = 0;
}
