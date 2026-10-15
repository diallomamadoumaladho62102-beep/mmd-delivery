import assert from "node:assert/strict";
import {
  onlineSheetMaxHeightPx,
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

const legacyPhone = Math.round(844 * 0.58);
const phoneDrop = legacyPhone - onlineSheetMaxHeightPx(844);
assert.ok(phoneDrop >= 60 && phoneDrop <= 80, "844pt phone reveals 60–80px more map");
assert.ok(onlineSheetMaxHeightPx(915) < Math.round(915 * 0.58));
assert.ok(onlineSheetMaxHeightPx(390) >= Math.round(390 * 0.48));
assert.equal(onlineSheetMaxHeightPx(0), 0);
assert.equal(onlineSheetMaxHeightPx(Number.NaN), 0);

console.log("driverScreenSafeArea.test.ts OK");
