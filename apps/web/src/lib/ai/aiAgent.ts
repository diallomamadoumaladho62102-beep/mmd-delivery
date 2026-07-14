import OpenAI from "openai";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import {
  estimateOpenAiCostUsd,
  mergeOpenAiUsage,
} from "@/lib/ai/aiOpenAiPricing";
import {
  getAiMaxToolIterations,
  getOpenAiApiKey,
  getOpenAiModel,
} from "@/lib/ai/aiConfig";
import { buildClientContext } from "@/lib/ai/contexts/buildClientContext";
import { buildClientSystemPrompt } from "@/lib/ai/prompts/clientSystemPrompt";
import type {
  AiAction,
  AiChatRequest,
  AiChatResponse,
  AiRole,
  AiToolContext,
} from "@/lib/ai/aiTypes";
import { AI_DISCLAIMER, detectEscalationReason } from "@/lib/ai/aiSafety";
import { getOpenAiToolDefinitions, runToolForRole } from "@/lib/ai/tools/registry";
import type { AiApiAuthSuccess } from "@/lib/ai/requireAiApiUser";

function createConversationId(existing?: string): string {
  const trimmed = String(existing ?? "").trim();
  if (trimmed) return trimmed.slice(0, 128);
  return crypto.randomUUID();
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function defaultClientSuggestions(): string[] {
  return ["Order food", "Book a taxi", "Send a package", "Track my order", "Contact support"];
}

export async function runMmdAiChat(params: {
  req: NextRequest;
  auth: AiApiAuthSuccess;
  body: AiChatRequest;
}): Promise<AiChatResponse> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const locale = String(params.body.locale ?? "en").split("-")[0].slice(0, 8) || "en";
  const conversationId = createConversationId(params.body.conversationId);
  const orderId = String(params.body.context?.orderId ?? "").trim() || undefined;
  const aiRole: AiRole = params.auth.aiRole === "client" ? "client" : params.auth.aiRole;

  const escalationKeyword = detectEscalationReason(params.body.message);
  const clientContext =
    aiRole === "client"
      ? await buildClientContext({
          supabaseAdmin: params.auth.supabaseAdmin,
          userId: params.auth.user.id,
          locale,
          orderId,
          req: params.req,
        })
      : null;

  const systemPrompt =
    aiRole === "client" && clientContext
      ? buildClientSystemPrompt(clientContext)
      : "You are MMD AI. This role is not enabled yet.";

  const openai = new OpenAI({ apiKey });
  const tools = getOpenAiToolDefinitions(aiRole);
  const toolCtx: AiToolContext = {
    userId: params.auth.user.id,
    role: params.auth.role,
    aiRole,
    locale,
    supabaseAdmin: params.auth.supabaseAdmin,
    supabaseUser: params.auth.supabaseUser,
    orderId,
  };

  const history = (params.body.history ?? [])
    .slice(-20)
    .filter((turn) => turn.content?.trim())
    .map((turn) => {
      const role = turn.role === "assistant" ? "assistant" : "user";
      return {
        role,
        content: turn.content.trim().slice(0, 2000),
      };
    });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: turn.content,
    })),
    { role: "user", content: params.body.message.trim().slice(0, 2000) },
  ];

  const toolsUsed: string[] = [];
  const collectedActions: AiAction[] = [];
  let escalatedToHuman = Boolean(escalationKeyword);
  const usageParts = [];

  for (let i = 0; i < getAiMaxToolIterations(); i += 1) {
    const completion = await openai.chat.completions.create({
      model: getOpenAiModel(),
      messages,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? "auto" : undefined,
      temperature: 0.4,
      max_tokens: 800,
    });

    if (completion.usage) {
      usageParts.push(
        estimateOpenAiCostUsd({
          promptTokens: completion.usage.prompt_tokens ?? 0,
          completionTokens: completion.usage.completion_tokens ?? 0,
          model: completion.model ?? getOpenAiModel(),
        })
      );
    }

    const choice = completion.choices[0];
    if (!choice) {
      break;
    }

    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls ?? [];

    if (!toolCalls.length) {
      const content =
        assistantMessage.content?.trim() ||
        (escalationKeyword
          ? "This needs a human MMD agent. I can connect you with support."
          : "How can I help you with MMD today?");

      if (escalationKeyword && collectedActions.length === 0) {
        collectedActions.push({
          type: "navigate",
          label: "Contact support",
          route: "ClientInbox",
          params: orderId ? { orderId } : {},
          priority: "high",
        });
      }

      const usage = mergeOpenAiUsage(usageParts);

      return {
        ok: true,
        conversationId,
        message: { role: "assistant", content, locale },
        actions: dedupeActions(collectedActions),
        suggestions: defaultClientSuggestions(),
        meta: {
          role: aiRole,
          toolsUsed,
          requiresConfirmation: false,
          escalatedToHuman,
          escalationReason: escalationKeyword ?? undefined,
          disclaimer: AI_DISCLAIMER,
          usage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
            model: usage.model,
          },
        },
      };
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const toolName = call.function.name;
      const toolArgs = parseToolArgs(call.function.arguments);
      toolsUsed.push(toolName);

      const result = await runToolForRole(aiRole, toolName, toolArgs, toolCtx);
      if (result.escalationReason) {
        escalatedToHuman = true;
      }
      if (result.actions?.length) {
        collectedActions.push(...result.actions);
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({
          ok: result.ok,
          summary: result.summary,
          data: result.data ?? {},
        }),
      });
    }
  }

  const usage = mergeOpenAiUsage(usageParts);

  return {
    ok: true,
    conversationId,
    message: {
      role: "assistant",
      content: escalatedToHuman
        ? "I've gathered what I can. A human support agent can help you next."
        : "I'm here to help with your MMD services.",
      locale,
    },
    actions: dedupeActions(collectedActions),
    suggestions: defaultClientSuggestions(),
    meta: {
      role: aiRole,
      toolsUsed,
      requiresConfirmation: false,
      escalatedToHuman,
      escalationReason: escalationKeyword ?? undefined,
      disclaimer: AI_DISCLAIMER,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        model: usage.model,
      },
    },
  };
}

function dedupeActions(actions: AiAction[]): AiAction[] {
  const seen = new Set<string>();
  const out: AiAction[] = [];
  for (const action of actions) {
    const key = `${action.type}:${action.label}:${JSON.stringify("params" in action ? action.params : {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}
