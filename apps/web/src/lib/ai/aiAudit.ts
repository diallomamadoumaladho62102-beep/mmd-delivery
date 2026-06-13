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
};

export function logAiAudit(entry: AiAuditEntry): void {
  if (process.env.NODE_ENV === "test") return;

  const payload = {
    event: "mmd_ai_chat",
    ...entry,
  };

  console.info("[mmd-ai]", JSON.stringify(payload));
}
