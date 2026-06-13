import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

export type AiChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AiNavigateAction = {
  type: "navigate";
  label: string;
  route: string;
  params?: Record<string, unknown>;
  icon?: string;
  priority?: "normal" | "high";
};

export type AiQuickReplyAction = {
  type: "quick_reply";
  label: string;
  intent: string;
};

export type AiAction = AiNavigateAction | AiQuickReplyAction;

export type AiChatSuccess = {
  ok: true;
  conversationId: string;
  message: {
    role: "assistant";
    content: string;
    locale: string;
  };
  actions: AiAction[];
  suggestions: string[];
  meta: {
    role: string;
    toolsUsed: string[];
    requiresConfirmation: boolean;
    escalatedToHuman: boolean;
    escalationReason?: string;
    disclaimer: string;
  };
};

export type AiChatError = {
  ok: false;
  error: string;
  code?: string;
  retryAfter?: number;
};

export type AiChatInput = {
  message: string;
  conversationId?: string;
  locale?: string;
  context?: {
    role?: "client";
    screen?: string;
    orderId?: string;
    source?: string;
  };
  history?: AiChatHistoryTurn[];
};

export class MmdAiApiError extends Error {
  code?: string;
  retryAfter?: number;

  constructor(message: string, code?: string, retryAfter?: number) {
    super(message);
    this.name = "MmdAiApiError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new MmdAiApiError("Session expired. Please sign in again.", "UNAUTHORIZED");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export async function postAiChat(input: AiChatInput): Promise<AiChatSuccess> {
  const res = await fetch(`${baseUrl()}/api/ai/chat`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(input),
  });

  const out = (await res.json().catch(() => null)) as AiChatSuccess | AiChatError | null;

  if (!out || out.ok !== true) {
    const err = out as AiChatError | null;
    throw new MmdAiApiError(
      err?.error ?? `MMD AI request failed (${res.status})`,
      err?.code,
      err?.retryAfter
    );
  }

  return out;
}

export async function fetchAiHealth(): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}/api/ai/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}
