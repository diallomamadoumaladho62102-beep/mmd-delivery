const INTENT_PATTERNS: Array<{ intent: string; patterns: RegExp[] }> = [
  { intent: "order_food", patterns: [/\border food\b/i, /\brestaurant\b/i, /\bfood\b/i, /\bmanger\b/i] },
  { intent: "book_taxi", patterns: [/\btaxi\b/i, /\bride\b/i, /\bcourse\b/i] },
  { intent: "send_package", patterns: [/\bpackage\b/i, /\bdelivery\b/i, /\blivraison\b/i, /\benvoyer\b/i] },
  { intent: "track_order", patterns: [/\btrack\b/i, /\bwhere is my\b/i, /\bstatus\b/i, /\bcommande\b/i] },
  { intent: "support", patterns: [/\bsupport\b/i, /\bhelp\b/i, /\baide\b/i, /\brefund\b/i] },
];

export function classifyAiIntent(message: string, toolsUsed: string[] = []): string {
  if (toolsUsed.length) {
    const tool = toolsUsed[0]?.trim();
    if (tool) return tool;
  }

  const text = String(message ?? "").trim();
  if (!text) return "general";

  for (const row of INTENT_PATTERNS) {
    if (row.patterns.some((re) => re.test(text))) {
      return row.intent;
    }
  }

  return "general";
}
