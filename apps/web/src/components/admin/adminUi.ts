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
  "/admin/delivery-requests": "📮",
  "/admin/taxi-rides": "🚕",
  "/admin/taxi-business-accounts": "🏢",
  "/admin/live-map": "🗺️",
  "/admin/supervision": "👁️",
  "/admin/clients": "👤",
  "/admin/drivers": "🚗",
  "/admin/driver-identity": "🪪",
  "/admin/identity": "🔐",
  "/admin/restaurants": "🍽️",
  "/admin/sellers": "🏪",
  "/admin/finance": "💰",
  "/admin/stripe": "💳",
  "/admin/payouts": "🏦",
  "/admin/commission-engine": "📈",
  "/admin/pricing": "🏷️",
  "/admin/loyalty": "⭐",
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
  "/admin/mmd-ai": "🤖",
  "/admin/mmd-ai/launch": "⚡",
  "/admin/staff": "👑",
  "/admin/teams": "🏢",
  "/admin/tasks": "✅",
  "/admin/analytics": "📉",
  "/admin/marketing": "📣",
};

export function navIcon(href: string): string {
  return NAV_ICONS[href] ?? "•";
}
