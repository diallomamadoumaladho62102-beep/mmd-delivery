/** Figma Admin App Desktop 1280 visual helpers. */

export const ADMIN_LOGO = "/brand/mmd-logo-ui.png";

export const NAV_ICONS: Record<string, string> = {
  "/admin": "📊",
  "/admin/hr": "👥",
  "/admin/orders": "📦",
  "/admin/dispatch": "🚛",
  "/admin/driver-offers": "🎯",
  "/admin/delivery-requests": "📮",
  "/admin/taxi-rides": "🚕",
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
