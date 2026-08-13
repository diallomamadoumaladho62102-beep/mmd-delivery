/**
 * Shared visual tokens aligned to Figma file m1YPra9RLUz38tGTPmYczj (Customer App).
 * Functional logic stays in screens — this file is UI tokens only.
 */

export const MMD_BLUE = "#003399";
export const MMD_BLUE_SOFT = "rgba(0, 43, 140, 0.35)";
/** Card / nav surface — Figma Customer App Lot 2 */
export const MMD_NAVY = "#001F59";
export const MMD_GOLD = "#F5C542";
/** Figma Lot 2 section titles / chevrons (#FFD700) */
export const MMD_GOLD_BRIGHT = "#FFD700";
export const MMD_GOLD_DARK = "#D9A621";
export const MMD_GOLD_BORDER = "rgba(217, 166, 33, 0.4)";
export const MMD_GOLD_BORDER_SOFT = "rgba(217, 166, 33, 0.1)";
export const MMD_CARD_BORDER = "rgba(255,255,255,0.15)";
/** Figma Lot 5 — card/input stroke on MMD_BLUE screens */
export const MMD_STROKE = "rgba(255,255,255,0.4)";
/** Card fills on MMD_BLUE (Inbox / Chat / Loyalty / MMD+ / Promotions) */
export const MMD_CARD_ON_BLUE = "rgba(0,51,153,0.65)";
export const MMD_CARD_ON_BLUE_STRONG = "rgba(0,51,153,0.95)";
/** Figma Lot 5 muted / soft / link blues */
export const MMD_TEXT_MUTED_BLUE = "#AABEE6";
export const MMD_TEXT_SOFT_BLUE = "#C8D7F5";
export const MMD_LINK_BLUE = "#729FFA";
/** Classic gold accent (#D4AF37) — AI chips, MMD+ CTAs, progress */
export const MMD_GOLD_CLASSIC = "#D4AF37";
/** Action greens — chat send, promo verify, loyalty redeem */
export const MMD_GREEN = "#37D43A";
export const MMD_GREEN_SOFT = "#34D399";
/** Figma Driver Auth primary CTA (#37D451) */
export const MMD_DRIVER_CTA = "#37D451";
/** Figma Driver Auth link / back (#93C5FD) */
export const MMD_DRIVER_LINK = "#93C5FD";
/** Soft field tint on MMD_BLUE driver forms */
export const MMD_DRIVER_FIELD_TINT = "rgba(0,43,140,0.5)";
/** Figma Lot 6 — taxi CTA / selected / tip / chat send (#22C55E) */
export const MMD_TAXI_GREEN = "#22C55E";
/** Figma Lot 6 — secondary action navy (Tailwind #04d) */
export const MMD_ACTION_NAVY = "#0044DD";
/** Figma Lot 6 — glass card fill on MMD_BLUE taxi screens */
export const MMD_GLASS = "rgba(255,255,255,0.08)";
/** Figma Lot 6 — classic gold card stroke (pairs with MMD_GOLD_CLASSIC) */
export const MMD_GOLD_CLASSIC_BORDER = "rgba(212,175,55,0.5)";
export const MMD_MUTED = "#B2B2BF";
export const MMD_TEXT = "#F8FAFC";
export const MMD_WHITE = "#FFFFFF";

/** Figma Phone 390 logo box on Role Select / Auth headers */
export const MMD_LOGO_SIZE_PHONE = 100;
/** Compact logo on Security / Wallet empty (phone = 80) */
export const MMD_LOGO_SIZE_COMPACT_PHONE = 80;

export const MMD_FONT = {
  regular: "Sora_400Regular",
  semibold: "Sora_600SemiBold",
  bold: "Sora_700Bold",
  extrabold: "Sora_800ExtraBold",
} as const;

export function mmdLogoSize(width: number, height: number): number {
  const tiny = height < 680 || width < 340;
  const tablet = width >= 768;
  if (tiny) return 84;
  if (tablet) return 120;
  return MMD_LOGO_SIZE_PHONE;
}

/** Compact logo: phone 80 / tiny 72 / tablet 96 */
export function mmdLogoSizeCompact(width: number, height: number): number {
  const tiny = height < 680 || width < 340;
  const tablet = width >= 768;
  if (tiny) return 72;
  if (tablet) return 96;
  return MMD_LOGO_SIZE_COMPACT_PHONE;
}
