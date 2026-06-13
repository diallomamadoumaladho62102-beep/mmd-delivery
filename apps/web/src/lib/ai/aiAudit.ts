import { logAiStructured } from "@/lib/ai/aiStructuredLog";

type AiAuditEntry = {
  ts: string;
  userId: string;
  role: string;
  locale: string;
  toolsUsed: string[];
  latencyMs: number;
  escalated: boolean;
  conversationId: string;
  messageLength: number;
  ip?: string;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  countryCode?: string | null;
  regionCode?: string | null;
  stateCode?: string | null;
};

export function logAiAudit(entry: AiAuditEntry): void {
  logAiStructured({
    event: "mmd_ai_chat",
    ts: entry.ts,
    userId: entry.userId,
    role: entry.role,
    locale: entry.locale,
    toolsUsed: entry.toolsUsed,
    latencyMs: entry.latencyMs,
    escalated: entry.escalated,
    conversationId: entry.conversationId,
    messageLength: entry.messageLength,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    estimatedCostUsd: entry.estimatedCostUsd,
    countryCode: entry.countryCode,
    regionCode: entry.regionCode,
    stateCode: entry.stateCode,
  });
}
