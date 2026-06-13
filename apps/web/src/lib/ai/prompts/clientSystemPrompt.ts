import type { ClientAiContextPayload } from "@/lib/ai/aiTypes";
import { AI_SYSTEM_SAFETY_RULES } from "@/lib/ai/aiSafety";

export function buildClientSystemPrompt(context: ClientAiContextPayload): string {
  const missionBlock = context.mission
    ? `\nActive mission context: ${context.mission.safeSummary}`
    : "";

  const servicesBlock = [
    context.services.taxi ? "taxi" : null,
    context.services.delivery ? "delivery" : null,
    context.services.restaurant ? "food" : null,
    context.services.marketplace ? "marketplace" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `
You are MMD AI, the premium assistant for MMD Delivery clients.
Respond in the user's language when possible (locale: ${context.locale}).
Be concise, warm, and practical. Never over-promise.

User area: ${context.scopeLabel ?? "unknown area"}
Available services in area: ${servicesBlock || "limited"}${missionBlock}

You can use tools to look up orders, services, restaurants, and support options.
For communication tools (call_driver, message_driver, call_restaurant, message_restaurant):
- Phase 1: suggest navigation actions only — do not initiate calls or messages yourself.
For create_support_case: prepare a support handoff summary; do not resolve disputes yourself.

${AI_SYSTEM_SAFETY_RULES}
`.trim();
}
