import type OpenAI from "openai";
import type { AiRole } from "@/lib/ai/aiTypes";
import { executeClientTool } from "@/lib/ai/tools/client/clientTools";
import { guardSensitiveAiTool } from "@/lib/ai/tools/guardSensitiveAiTool";

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
  "get_taxi_categories",
  "quote_taxi",
  "prepare_taxi_booking",
  "get_recent_taxi_rides",
  "get_restaurant_menu",
  "quote_food_order",
  "prepare_food_order",
  "search_mmd_help",
  "search_places",
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
    toolDef("get_taxi_categories", "List available taxi vehicle categories.", {}),
    toolDef("quote_taxi", "Estimate a taxi fare using the official taxi quote engine. Never charges the client.", {
      pickup_address: { type: "string" },
      dropoff_address: { type: "string" },
      vehicle_class: { type: "string" },
      country_code: { type: "string" },
      pickup_lat: { type: "number" },
      pickup_lng: { type: "number" },
      dropoff_lat: { type: "number" },
      dropoff_lng: { type: "number" },
    }),
    toolDef("prepare_taxi_booking", "Prepare a taxi recap and hand off to official Taxi checkout after client confirmation. Never pays.", {
      pickup_address: { type: "string" },
      dropoff_address: { type: "string" },
      vehicle_class: { type: "string" },
    }),
    toolDef("get_recent_taxi_rides", "List the client's recent taxi rides.", {
      limit: { type: "number" },
    }),
    toolDef("get_restaurant_menu", "Read an approved restaurant menu from restaurant_items.", {
      restaurant_id: { type: "string" },
    }),
    toolDef("quote_food_order", "Estimate a food order using the official food quote engine. Never charges the client.", {
      restaurant_id: { type: "string" },
      restaurant_name: { type: "string" },
      items: { type: "string", description: "JSON array of {item_id, quantity, options?}" },
      pickup_address: { type: "string" },
      dropoff_address: { type: "string" },
      pickup_lat: { type: "number" },
      pickup_lng: { type: "number" },
      dropoff_lat: { type: "number" },
      dropoff_lng: { type: "number" },
    }),
    toolDef("prepare_food_order", "Prepare a food-order recap and hand off to the official restaurant menu after confirmation. Never pays.", {
      restaurant_id: { type: "string" },
      restaurant_name: { type: "string" },
    }),
    toolDef("search_mmd_help", "Search official public MMD FAQ and published CMS pages. Never invent rules.", {
      query: { type: "string" },
    }),
    toolDef(
      "search_places",
      "Search public places and addresses via Mapbox (hospital, school, mosque, church, gas station, police, hotel, parking, playground, supermarket, bank, transit, etc.). Never invent an address. If the client wants the nearest place but no coordinates or city/area is available, ask for a city, neighborhood, or address. Public store addresses (e.g. Walmart) are allowed. Do not use this to operate competing apps.",
      {
        query: { type: "string", description: "Place name or free-text search" },
        category: {
          type: "string",
          description:
            "hospital, clinic, pharmacy, school, university, daycare, mosque, church, synagogue, place_of_worship, gas_station, police, fire_station, hotel, motel, parking, park, playground, supermarket, grocery, mall, bank, atm, restaurant, cafe, transit_station, train_station, bus_stop, airport",
        },
        name: { type: "string", description: "Exact establishment name when the client gave one" },
        area: { type: "string", description: "City, neighborhood, or address to search around" },
        city: { type: "string" },
        address: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        nearest: { type: "boolean" },
        radius_meters: { type: "number" },
        country_code: { type: "string" },
        limit: { type: "number" },
      }
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
  const blocked = guardSensitiveAiTool(name);
  if (blocked) return blocked;

  if (role === "client") {
    return executeClientTool(name, args, ctx);
  }
  return { ok: false, summary: `Tool ${name} is not enabled for role ${role} yet.` };
}
