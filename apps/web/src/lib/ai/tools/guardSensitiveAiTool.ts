import { isBlockedAutoAction } from "@/lib/ai/aiSafety";
import type { AiToolResult } from "@/lib/ai/aiTypes";

export function guardSensitiveAiTool(name: string): AiToolResult | null {
  if (!isBlockedAutoAction(name)) return null;
  return {
    ok: false,
    blocked: true,
    summary:
      "MMD AI cannot perform payments, cancellations, refunds, or booking confirmation. Use the official MMD Taxi or Food checkout after you confirm.",
    data: { tool: name, phase: "blocked_auto_action" },
  };
}
