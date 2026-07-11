/**
 * Pure safe-area math for the driver navigation overlays.
 *
 * All navigation chrome (top instruction HUD, floating controls, bottom trip
 * bar, arrival panel, status banner) is positioned from the *real* device
 * insets provided by `react-native-safe-area-context`, never from fragile fixed
 * pixel values. This keeps text/buttons/ETA clear of the status bar, notch /
 * Dynamic Island, Android navigation bar and the iOS home indicator on both
 * small (e.g. BLU G34) and large (e.g. iPhone Pro Max) devices.
 */

export type EdgeInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Base breathing room applied on top of the raw inset. */
export const HUD_TOP_BASE_PADDING = 14;
export const HUD_BOTTOM_PADDING = 14;
export const BOTTOM_BAR_BASE_PADDING = 14;
/** Guarantee a finger-safe gap even when the OS reports a tiny/zero inset. */
export const MIN_TOP_SAFE = 8;
export const MIN_BOTTOM_SAFE = 10;

function clampInset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Top padding for the instruction HUD: status bar / notch + base padding. */
export function resolveHudTopPadding(insetTop: number): number {
  return Math.max(MIN_TOP_SAFE, clampInset(insetTop)) + HUD_TOP_BASE_PADDING;
}

/**
 * Bottom padding for the trip bar. Unlike the previous Android-only handling,
 * the iOS home indicator inset is now honored too so the ETA/distance line is
 * never clipped by the home indicator.
 */
export function resolveBottomBarPadding(insetBottom: number): number {
  return BOTTOM_BAR_BASE_PADDING + Math.max(MIN_BOTTOM_SAFE, clampInset(insetBottom));
}

/** Absolute-position offsets (px from the edge) for floating overlays. */
export function resolveOverlayInsets(insets: EdgeInsets): {
  hudHeightEstimate: number;
  statusBannerTop: number;
  controlsTop: number;
  arrivalBannerBottom: number;
  alertPillBottom: number;
} {
  const top = Math.max(MIN_TOP_SAFE, clampInset(insets.top));
  const bottom = Math.max(MIN_BOTTOM_SAFE, clampInset(insets.bottom));

  // Rough HUD height so overlays anchored below it never overlap the HUD.
  const hudHeightEstimate = top + HUD_TOP_BASE_PADDING + 62 + HUD_BOTTOM_PADDING;

  return {
    hudHeightEstimate,
    statusBannerTop: hudHeightEstimate + 8,
    controlsTop: hudHeightEstimate + 12,
    arrivalBannerBottom: bottom + 96,
    alertPillBottom: bottom + 100,
  };
}
