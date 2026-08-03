import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RestaurantOrderAutomationSettings,
  RestaurantPrintJobType,
} from "@/lib/restaurantOrderAutomationTypes";

export type PrintTicketPayload = {
  order_id: string;
  order_number: string;
  restaurant_name: string;
  restaurant_address?: string | null;
  created_at: string | null;
  order_type?: string | null;
  client_label?: string | null;
  dropoff_address?: string | null;
  delivery_instructions?: string | null;
  kitchen_notes?: string | null;
  items: Array<{
    name: string;
    quantity: number;
    /** Compatibility only — never shown on kitchen tickets. */
    line_total?: number | null;
    options?: unknown;
    notes?: string | null;
    category?: string | null;
  }>;
  /** Compatibility only — never shown on kitchen tickets. */
  total: number | null;
  currency: string | null;
  pickup_code: string | null;
  dropoff_code: string | null;
  special_instructions: string | null;
  show_qr_code: boolean;
  show_special_instructions: boolean;
  paper_width: "58mm" | "80mm";
  ticket_type: RestaurantPrintJobType;
};

function shortOrderNumber(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function extractKitchenNotes(items: Array<Record<string, unknown>>): string | null {
  const notes = items
    .map((line) =>
      String(line.notes ?? line.note ?? line.kitchen_note ?? "").trim(),
    )
    .filter(Boolean);
  return notes.length ? notes.join(" · ") : null;
}

function mapItems(itemsJson: unknown) {
  if (!Array.isArray(itemsJson)) return [];
  return itemsJson.map((line: Record<string, unknown>) => ({
    name: String(line.name ?? "Item"),
    quantity: Number(line.quantity ?? 1) || 1,
    line_total: null,
    options: line.options ?? line.variants ?? line.extras ?? null,
    notes: String(line.notes ?? line.note ?? "").trim() || null,
    category: line.category != null ? String(line.category) : null,
  }));
}

export async function buildPrintPayloadForOrder(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    restaurantName: string;
    settings: RestaurantOrderAutomationSettings;
    jobType: RestaurantPrintJobType;
  },
): Promise<PrintTicketPayload | null> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id,created_at,items_json,pickup_code,dropoff_code,leave_at_door,dropoff_address,pickup_address,client_user_id,client_id,restaurant_name",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (!order) return null;

  const items = mapItems(order.items_json);
  const clientId = String(order.client_user_id ?? order.client_id ?? "").trim();
  let clientLabel: string | null = clientId
    ? `Client ${clientId.slice(0, 8)}`
    : null;

  if (clientId) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", clientId)
      .maybeSingle();
    const name = String(profile?.full_name ?? "").trim();
    if (name) {
      const first = name.split(/\s+/)[0] ?? name;
      clientLabel = first;
    }
  }

  const deliveryInstructions = order.leave_at_door
    ? "Laisser à la porte"
    : null;

  return {
    order_id: order.id,
    order_number: shortOrderNumber(order.id),
    restaurant_name: input.restaurantName || String(order.restaurant_name ?? "Restaurant"),
    restaurant_address: order.pickup_address ?? null,
    created_at: order.created_at ?? null,
    order_type: "Livraison",
    client_label: clientLabel,
    dropoff_address: order.dropoff_address ?? null,
    delivery_instructions: deliveryInstructions,
    kitchen_notes: extractKitchenNotes(
      Array.isArray(order.items_json)
        ? (order.items_json as Array<Record<string, unknown>>)
        : [],
    ),
    items,
    total: null,
    currency: null,
    pickup_code: order.pickup_code ?? null,
    dropoff_code: order.dropoff_code ?? null,
    special_instructions: deliveryInstructions,
    show_qr_code: input.settings.print_show_qr_code,
    show_special_instructions: input.settings.print_special_instructions,
    paper_width: input.settings.print_paper_width,
    ticket_type: input.jobType,
  };
}

export async function queueRestaurantPrintJobsForOrder(input: {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  orderId: string;
  settings: RestaurantOrderAutomationSettings;
  source?: "auto" | "manual" | "reprint" | "test";
}): Promise<number> {
  const { data: profile } = await input.supabaseAdmin
    .from("restaurant_profiles")
    .select("restaurant_name")
    .eq("user_id", input.restaurantUserId)
    .maybeSingle();

  const restaurantName = String(profile?.restaurant_name ?? "Restaurant");
  const jobs: RestaurantPrintJobType[] = [];

  if (input.settings.print_kitchen_ticket) jobs.push("kitchen");
  if (input.settings.print_customer_ticket) jobs.push("customer");
  if (input.settings.print_driver_ticket) jobs.push("driver");

  if (jobs.length === 0) return 0;

  let created = 0;
  for (const jobType of jobs) {
    const payload = await buildPrintPayloadForOrder(input.supabaseAdmin, {
      orderId: input.orderId,
      restaurantName,
      settings: input.settings,
      jobType,
    });
    if (!payload) continue;

    const { error } = await input.supabaseAdmin.from("restaurant_print_jobs").insert({
      restaurant_user_id: input.restaurantUserId,
      order_id: input.orderId,
      job_type: jobType,
      status: "pending",
      copies: input.settings.print_copies,
      paper_width: input.settings.print_paper_width,
      payload,
      source: input.source ?? "auto",
    });

    if (!error) created += 1;
  }

  return created;
}

export async function queueRestaurantTestPrintJob(input: {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  settings: RestaurantOrderAutomationSettings;
}): Promise<string | null> {
  const { data: profile } = await input.supabaseAdmin
    .from("restaurant_profiles")
    .select("restaurant_name")
    .eq("user_id", input.restaurantUserId)
    .maybeSingle();

  const payload: PrintTicketPayload = {
    order_id: "00000000-0000-0000-0000-000000000000",
    order_number: "TEST0001",
    restaurant_name: String(profile?.restaurant_name ?? "Restaurant"),
    restaurant_address: "123 Main Street",
    created_at: new Date().toISOString(),
    order_type: "Livraison",
    client_label: "Awa",
    dropoff_address: "45 Avenue de la Paix",
    delivery_instructions: "Ne pas sonner. Laisser à la porte.",
    kitchen_notes: "Sans oignons · Bien emballer",
    items: [
      {
        name: "Burger Classic",
        quantity: 2,
        line_total: null,
        options: ["Regular", "Sans oignon"],
      },
      {
        name: "Frites",
        quantity: 1,
        line_total: null,
        options: ["Sauce à part"],
      },
    ],
    total: null,
    currency: null,
    pickup_code: "BHZ3Y3",
    dropoff_code: null,
    special_instructions: "Ne pas sonner. Laisser à la porte.",
    show_qr_code: input.settings.print_show_qr_code,
    show_special_instructions: input.settings.print_special_instructions,
    paper_width: input.settings.print_paper_width,
    ticket_type: "test",
  };

  const { data, error } = await input.supabaseAdmin
    .from("restaurant_print_jobs")
    .insert({
      restaurant_user_id: input.restaurantUserId,
      order_id: null,
      job_type: "test",
      status: "pending",
      copies: input.settings.print_copies,
      paper_width: input.settings.print_paper_width,
      payload,
      source: "test",
    })
    .select("id")
    .single();

  if (error) return null;
  return data.id as string;
}
