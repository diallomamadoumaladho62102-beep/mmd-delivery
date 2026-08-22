import type { StyleProp, ViewStyle } from "react-native";

/** Max content width on tablet — matches client marketplace / restaurant patterns. */
export const SELLER_CONTENT_MAX_WIDTH = 720;

export function resolveSellerContentMaxWidth(windowWidth: number): number | undefined {
  return windowWidth >= 768 ? SELLER_CONTENT_MAX_WIDTH : undefined;
}

export function sellerContentWidthStyle(
  maxWidth?: number
): StyleProp<ViewStyle> | null {
  if (!maxWidth) return null;
  return { maxWidth, alignSelf: "center", width: "100%" };
}
