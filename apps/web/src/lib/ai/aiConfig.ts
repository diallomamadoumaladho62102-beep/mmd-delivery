export function isAiAssistantEnabled(): boolean {
  const raw = String(process.env.AI_ASSISTANT_ENABLED ?? "false")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

export function getAiRateLimitWindowMs(): number {
  const raw = Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? 600_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

export function getAiRateLimitMaxPerUser(): number {
  const raw = Number(process.env.AI_RATE_LIMIT_MAX_PER_USER ?? 20);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 20;
}

export function getAiMaxMessageLength(): number {
  return 2000;
}

export function getAiMaxHistoryTurns(): number {
  return 20;
}

export function getAiMaxToolIterations(): number {
  return 4;
}
