/**
 * Pure safe-area helpers for Driver stack/tab screens (Node-testable).
 *
 * Tab screens (Driver Home) already reserve tab-bar clearance statically;
 * we add only the *extra* home-indicator inset beyond that baseline so CTAs
 * never sit under the iOS home bar or iPad gesture area.
 *
 * Stack screens (order details) have no tab bar — action bars must sit
 * `gap + inset.bottom` above the physical edge.
 */

import { MIN_BOTTOM_SAFE } from "./navigationSafeArea";

function clampInset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Bottom padding for Driver Home sheet / offer cards above the tab bar. */
export function resolveDriverTabBottomPadding(params: {
  tabClearance: number;
  navSafeOffset: number;
  insetBottom: number;
}): number {
  const base = params.tabClearance + params.navSafeOffset;
  const extraInset = Math.max(0, clampInset(params.insetBottom) - params.navSafeOffset);
  return base + extraInset;
}

/** Absolute `bottom` for fixed action bars on Driver stack screens. */
export function resolveDriverStackActionBottom(insetBottom: number, gap = 16): number {
  return gap + Math.max(MIN_BOTTOM_SAFE, clampInset(insetBottom));
}

/** ScrollView padding so scrollable content clears a bottom action bar. */
export function resolveDriverStackScrollBottomPadding(
  actionBarHeight: number,
  insetBottom: number,
  gap = 16,
): number {
  return actionBarHeight + gap + Math.max(MIN_BOTTOM_SAFE, clampInset(insetBottom));
}
