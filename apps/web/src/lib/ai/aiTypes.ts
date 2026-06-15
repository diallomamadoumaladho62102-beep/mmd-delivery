import type { UserRole } from "@/lib/roles";

export type AiRole = "client" | "driver" | "restaurant" | "admin";

export type AiChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AiChatContext = {
  role?: AiRole;
  screen?: string;
  orderId?: string;
  source?: string;
  countryCode?: string;
  stateCode?: string;
  regionCode?: string;
  currencyCode?: string;
};

export type AiChatRequest = {
  message: string;
  conversationId?: string;
  locale?: string;
  context?: AiChatContext;
  history?: AiChatHistoryTurn[];
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

export type AiChatUsageMeta = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
};

export type AiChatResponse = {
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
    role: AiRole;
    toolsUsed: string[];
    requiresConfirmation: boolean;
    escalatedToHuman: boolean;
    escalationReason?: string;
    disclaimer: string;
    usage?: AiChatUsageMeta;
  };
};

export type AiErrorResponse = {
  ok: false;
  error: string;
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN_ROLE"
    | "AI_DISABLED"
    | "AI_NOT_AVAILABLE_IN_REGION"
    | "AI_TEMPORARILY_DISABLED"
    | "AI_RATE_LIMIT"
    | "AI_UNAVAILABLE"
    | "INVALID_REQUEST"
    | "OPENAI_ERROR";
  retryAfter?: number;
};

export type AiToolContext = {
  userId: string;
  role: UserRole;
  aiRole: AiRole;
  locale: string;
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient;
  supabaseUser: import("@supabase/supabase-js").SupabaseClient;
  orderId?: string;
};

export type AiToolResult = {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  actions?: AiAction[];
  escalationReason?: string;
};

export type SharedMissionContext = {
  missionId: string;
  missionKind: "restaurant_order" | "delivery_request" | "taxi_ride" | "unknown";
  status: string;
  paymentStatus: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  restaurantName: string | null;
  driverAssigned: boolean;
  viewerRole: AiRole;
  safeSummary: string;
};

export type ClientAiContextPayload = {
  locale: string;
  scopeLabel: string | null;
  services: {
    taxi: boolean;
    delivery: boolean;
    restaurant: boolean;
    marketplace: boolean;
  };
  mission?: SharedMissionContext;
};
