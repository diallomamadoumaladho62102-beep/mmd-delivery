const ESCALATION_KEYWORDS = [
  "refund",
  "remboursement",
  "dispute",
  "litige",
  "accident",
  "stolen",
  "volé",
  "harass",
  "harcèlement",
  "chargeback",
  "fraud",
  "fraude",
  "police",
  "emergency",
  "urgence",
  "injured",
  "blessé",
];

const BLOCKED_AUTO_ACTIONS = new Set([
  "payment",
  "cancel",
  "refund",
  "accept_mission",
  "reject_mission",
  "dispatch_modify",
  "order_modify",
  "price_change",
  "payout_change",
  "menu_delete",
  "restaurant_close",
]);

export function detectEscalationReason(message: string): string | null {
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

export function isBlockedAutoAction(actionName: string): boolean {
  return BLOCKED_AUTO_ACTIONS.has(actionName.trim().toLowerCase());
}

export const AI_DISCLAIMER =
  "MMD AI provides guidance only. For payments, refunds, cancellations, or disputes, contact MMD support.";

export const AI_SYSTEM_SAFETY_RULES = `
Safety rules (mandatory):
- Never promise automatic refunds, payments, or compensation.
- Never confirm payment status as guaranteed.
- Never modify, cancel, or accept orders/missions automatically.
- Never change menu, prices, hours, or payouts.
- If the user mentions accident, dispute, fraud, harassment, or emergency → recommend human support immediately.
- If uncertain → explain clearly and offer Contact support or create_support_case.
- Do not expose sensitive data (full payment IDs, internal tokens, other users' data).
- Area estimates and ETAs are not live guarantees.
`.trim();
