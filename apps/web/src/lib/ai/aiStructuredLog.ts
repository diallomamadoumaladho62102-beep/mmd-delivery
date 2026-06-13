export type AiStructuredEventType =
  | "mmd_ai_chat"
  | "mmd_ai_error"
  | "mmd_ai_rate_limit"
  | "mmd_ai_escalation"
  | "mmd_ai_cost_cap_reached";

export type AiStructuredLogEntry = {
  event: AiStructuredEventType;
  ts: string;
  userId?: string;
  conversationId?: string;
  role?: string;
  locale?: string;
  errorCode?: string;
  toolsUsed?: string[];
  latencyMs?: number;
  messageLength?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  escalated?: boolean;
  countryCode?: string | null;
  regionCode?: string | null;
  stateCode?: string | null;
  intent?: string;
};

export function logAiStructured(entry: AiStructuredLogEntry): void {
  if (process.env.NODE_ENV === "test") return;
  console.info("[mmd-ai]", JSON.stringify(entry));
}
