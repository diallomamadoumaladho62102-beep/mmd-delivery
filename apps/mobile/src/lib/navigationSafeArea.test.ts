import {
  BOTTOM_BAR_BASE_PADDING,
  HUD_TOP_BASE_PADDING,
  MIN_BOTTOM_SAFE,
  MIN_TOP_SAFE,
  resolveBottomBarPadding,
  resolveHudTopPadding,
  resolveOverlayInsets,
} from "./navigationSafeArea";
import { computeNavigationScreenLayout } from "./driverNavigationVisual";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- Top HUD padding uses the real inset, with a floor. ---
assert(
  resolveHudTopPadding(0) === MIN_TOP_SAFE + HUD_TOP_BASE_PADDING,
  "hud top floor when inset 0",
);
assert(
  resolveHudTopPadding(59) === 59 + HUD_TOP_BASE_PADDING,
  "hud top uses notch inset (iPhone Dynamic Island ~59)",
);
assert(
  resolveHudTopPadding(24) === 24 + HUD_TOP_BASE_PADDING,
  "hud top uses Android status bar inset",
);

// --- Bottom bar honors the home indicator on iOS AND Android nav bar. ---
assert(
  resolveBottomBarPadding(0) === BOTTOM_BAR_BASE_PADDING + MIN_BOTTOM_SAFE,
  "bottom floor when inset 0",
);
assert(
  resolveBottomBarPadding(34) === BOTTOM_BAR_BASE_PADDING + 34,
  "bottom uses iOS home indicator inset (34)",
);
assert(
  resolveBottomBarPadding(48) === BOTTOM_BAR_BASE_PADDING + 48,
  "bottom uses Android nav bar inset",
);

// --- Overlay insets are ordered and below the HUD. ---
const overlay = resolveOverlayInsets({ top: 59, bottom: 34, left: 0, right: 0 });
assert(overlay.statusBannerTop > overlay.hudHeightEstimate, "status banner below HUD");
assert(overlay.controlsTop > overlay.hudHeightEstimate, "controls below HUD");
assert(overlay.arrivalBannerBottom >= 34 + 96, "arrival banner above home indicator");
assert(overlay.alertPillBottom >= 34 + 100, "alert pill above home indicator");

// Larger notch pushes chrome further from the edge.
const small = resolveOverlayInsets({ top: 0, bottom: 0, left: 0, right: 0 });
const large = resolveOverlayInsets({ top: 59, bottom: 34, left: 0, right: 0 });
assert(large.statusBannerTop > small.statusBannerTop, "bigger notch → lower banner");
assert(large.arrivalBannerBottom > small.arrivalBannerBottom, "bigger inset → higher arrival");

// --- Camera layout folds real insets into padding. ---
const screen = { width: 393, height: 852 }; // iPhone 15
const noInset = computeNavigationScreenLayout(screen);
const withInset = computeNavigationScreenLayout(screen, {
  top: 59,
  bottom: 34,
  left: 0,
  right: 0,
});
assert(
  withInset.cameraPaddingTop > noInset.cameraPaddingTop,
  "top inset increases camera top padding",
);
assert(
  withInset.cameraPaddingBottom > noInset.cameraPaddingBottom,
  "bottom inset increases camera bottom padding",
);

// Backward compatible: no insets == previous behavior.
assert(
  computeNavigationScreenLayout(screen).cameraPaddingBottom ===
    computeNavigationScreenLayout(screen, { top: 0, bottom: 0, left: 0, right: 0 })
      .cameraPaddingBottom,
  "zero insets preserve legacy layout",
);

console.log("navigationSafeArea tests passed");
