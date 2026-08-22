import assert from "node:assert/strict";
import {
  resolveDriverStackActionBottom,
  resolveDriverStackScrollBottomPadding,
  resolveDriverTabBottomPadding,
} from "./driverScreenSafeArea";

// iPhone tab bar baseline (58 + 22 = 80)
const IOS_TAB = 58;
const IOS_NAV_SAFE = 22;

assert.equal(
  resolveDriverTabBottomPadding({
    tabClearance: IOS_TAB,
    navSafeOffset: IOS_NAV_SAFE,
    insetBottom: 0,
  }),
  80,
  "zero inset uses static baseline only",
);

assert.equal(
  resolveDriverTabBottomPadding({
    tabClearance: IOS_TAB,
    navSafeOffset: IOS_NAV_SAFE,
    insetBottom: 34,
  }),
  80 + 12,
  "iPhone home indicator adds only delta beyond navSafeOffset",
);

assert.equal(
  resolveDriverTabBottomPadding({
    tabClearance: IOS_TAB,
    navSafeOffset: IOS_NAV_SAFE,
    insetBottom: 20,
  }),
  80,
  "iPad inset within navSafeOffset does not double-count",
);

assert.equal(resolveDriverStackActionBottom(0), 16 + 10, "stack action floor when inset 0");
assert.equal(resolveDriverStackActionBottom(34), 16 + 34, "stack action honors home indicator");
assert.equal(
  resolveDriverStackScrollBottomPadding(100, 34),
  100 + 16 + 34,
  "scroll clears action bar + gap + inset",
);

console.log("driverScreenSafeArea.test.ts OK");
