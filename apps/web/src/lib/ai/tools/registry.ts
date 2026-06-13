import type OpenAI from "openai";
import type { AiRole } from "@/lib/ai/aiTypes";
import { executeClientTool } from "@/lib/ai/tools/client/clientTools";

export const CLIENT_TOOL_NAMES = [
  "get_recent_orders",
  "track_order",
  "search_restaurants",
  "get_user_region_scope",
  "get_available_services",
  "explain_order_status",
  "contact_support",
  "create_support_case",
  "call_driver",
  "message_driver",
  "call_restaurant",
  "message_restaurant",
] as const;

export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

export function getOpenAiToolDefinitions(role: AiRole): OpenAI.Chat.Completions.ChatCompletionTool[] {
  if (role !== "client") {
    return [];
  }

  return [
    toolDef("get_recent_orders", "List the client's recent orders and delivery requests.", {
      limit: { type: "number", description: "Max items (1-10, default 5)" },
    }),
    toolDef("track_order", "Track a specific order by ID.", {
      order_id: { type: "string", description: "Order UUID" },
    }),
    toolDef("search_restaurants", "Search approved restaurants accepting orders.", {
      query: { type: "string", description: "Name, cuisine, or address fragment" },
      limit: { type: "number" },
    }),
    toolDef("get_user_region_scope", "Get the client's market/region scope label.", {}),
    toolDef("get_available_services", "Get which MMD services are available in the client's area.", {}),
    toolDef("explain_order_status", "Explain what an order status means.", {
      status: { type: "string" },
    }),
    toolDef("contact_support", "Provide MMD support contact and inbox navigation.", {
      topic: { type: "string" },
    }),
    toolDef(
      "create_support_case",
      "Prepare a human support case handoff (no automatic resolution).",
      {
        reason: { type: "string" },
        details: { type: "string" },
        order_id: { type: "string" },
      }
    ),
    toolDef(
      "call_driver",
      "Navigate client to masked call with driver (Phase 1: navigation only).",
      { order_id: { type: "string" } }
    ),
    toolDef(
      "message_driver",
      "Navigate client to driver chat (Phase 1: navigation only).",
      { order_id: { type: "string" } }
    ),
    toolDef(
      "call_restaurant",
      "Navigate client to masked call with restaurant (Phase 1: navigation only).",
      { order_id: { type: "string" } }
    ),
    toolDef(
      "message_restaurant",
      "Navigate client to restaurant chat (Phase 1: navigation only).",
      { order_id: { type: "string" } }
    ),
  ];
}

function toolDef(
  name: string,
  description: string,
  properties: Record<string, { type: string; description?: string }>
): OpenAI.Chat.Completions.ChatCompletionTool {
  const propKeys = Object.keys(properties);
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        ...(propKeys.length ? { required: [] } : {}),
      },
    },
  };
}

export async function runToolForRole(
  role: AiRole,
  name: string,
  args: Record<string, unknown>,
  ctx: Parameters<typeof executeClientTool>[2]
) {
  if (role === "client") {
    return executeClientTool(name, args, ctx);
  }
  return { ok: false, summary: `Tool ${name} is not enabled for role ${role} yet.` };
}
