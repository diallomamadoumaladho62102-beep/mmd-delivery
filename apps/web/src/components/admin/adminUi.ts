/** Figma Admin App Desktop 1280 visual helpers. */

export const ADMIN_LOGO = "/brand/mmd-logo-ui.png";

/** Shared Control Center primitives — use inside AdminShell (.admin-figma). */
export const CC_INPUT = "cc-input";
export const CC_BTN = "cc-btn";
export const CC_BTN_PRIMARY = "cc-btn cc-btn-primary";
export const CC_BTN_SECONDARY = "cc-btn cc-btn-secondary";
export const CC_BTN_GHOST = "cc-btn cc-btn-ghost";
export const CC_BTN_DANGER = "cc-btn cc-btn-danger";
export const CC_TABLE_WRAP = "cc-table-wrap";
export const CC_TABLE = "cc-table";
export const CC_PAGE_TITLE = "cc-page-title";
export const CC_PAGE_SUBTITLE = "cc-page-subtitle";
export const CC_ROLE_BADGE = "cc-role-badge";
export const CC_SIDEBAR_LINK = "cc-sidebar-link";
export const CC_SIDEBAR_LINK_ACTIVE = "cc-sidebar-link cc-sidebar-link-active";

export type CcBadgeTone =
  | "success"
  | "warn"
  | "info"
  | "critical"
  | "neutral"
  | "ai";

export const CC_BADGE: Record<CcBadgeTone, string> = {
  success: "cc-badge cc-badge-success",
  warn: "cc-badge cc-badge-warn",
  info: "cc-badge cc-badge-info",
  critical: "cc-badge cc-badge-critical",
  neutral: "cc-badge cc-badge-neutral",
  ai: "cc-badge cc-badge-ai",
};

export function ccBadgeClass(tone: CcBadgeTone): string {
  return CC_BADGE[tone];
}

export const NAV_ICONS: Record<string, string> = {
  "/admin": "📊",
  "/admin/hr": "👥",
  "/admin/orders": "📦",
  "/admin/dispatch": "🚛",
  "/admin/driver-offers": "🎯",
  "/admin/driver-opportunities": "🧭",
  "/admin/delivery-requests": "📮",
  "/admin/taxi-rides": "🚕",
  "/admin/taxi-scheduled": "📅",
  "/admin/taxi-shared-rides": "👥",
  "/admin/taxi-promotions": "🎟️",
  "/admin/taxi-dispatch-preferences": "⚙️",
  "/admin/taxi-business-accounts": "🏢",
  "/admin/ops/stale-driver-jobs": "⏳",
  "/admin/marketplace-orders": "🛒",
  "/admin/marketplace-dispatch": "🚚",
  "/admin/marketplace-delivery-shadow": "🌑",
  "/admin/marketplace-payouts": "💵",
  "/admin/live-map": "🗺️",
  "/admin/supervision": "👁️",
  "/admin/clients": "👤",
  "/admin/drivers": "🚗",
  "/admin/taxi-drivers": "🚕",
  "/admin/driver-vehicles": "🚙",
  "/admin/taxi-driver-quality": "🏅",
  "/admin/driver-identity": "🪪",
  "/admin/identity": "🔐",
  "/admin/restaurants": "🍽️",
  "/admin/restaurants/order-automation": "🤖",
  "/admin/sellers": "🏪",
  "/admin/finance": "💰",
  "/admin/stripe": "💳",
  "/admin/payouts": "🏦",
  "/admin/commission-engine": "📈",
  "/admin/pricing": "🏷️",
  "/admin/taxi-pricing": "🚕",
  "/admin/taxi-taxes": "🧾",
  "/admin/taxi-exchange-rates": "💱",
  "/admin/payment-methods": "💸",
  "/admin/payout-methods": "🏧",
  "/admin/loyalty": "⭐",
  "/admin/taxi-loyalty": "🎖️",
  "/admin/taxi-loyalty-rewards": "🎁",
  "/admin/subscriptions": "📑",
  "/admin/mmd-plus": "➕",
  "/admin/road-safety": "🛡️",
  "/admin/ride-safety-recording-rules": "🎥",
  "/admin/audit": "📋",
  "/admin/chats": "💬",
  "/admin/calls": "📞",
  "/admin/communication": "🔔",
  "/admin/platform-launch": "🚀",
  "/admin/county-management": "📍",
  "/admin/taxi-countries": "🌍",
  "/admin/taxi-launch": "🚦",
  "/admin/taxi-monitoring": "📡",
  "/admin/mmd-ai": "🤖",
  "/admin/mmd-ai/launch": "⚡",
  "/admin/staff": "👑",
  "/admin/teams": "🏢",
  "/admin/tasks": "✅",
  "/admin/analytics": "📉",
  "/admin/marketing": "📣",
  "/admin/advertisements": "📢",
  "/admin/site": "🌐",
  "/admin/test-records": "🧪",
};

export function navIcon(href: string): string {
  return NAV_ICONS[href] ?? "•";
}
