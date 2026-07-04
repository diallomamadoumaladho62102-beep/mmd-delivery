import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RestaurantOrderAutomationSettings,
  RestaurantPrintJobType,
} from "@/lib/restaurantOrderAutomationTypes";

export type PrintTicketPayload = {
  order_id: string;
  order_number: string;
  restaurant_name: string;
  created_at: string | null;
  items: Array<{
    name: string;
    quantity: number;
    line_total?: number | null;
    options?: unknown;
  }>;
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
      "id,created_at,items_json,total,grand_total,currency,pickup_code,dropoff_code,leave_at_door",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (!order) return null;

  const items = Array.isArray(order.items_json)
    ? order.items_json.map((line: Record<string, unknown>) => ({
        name: String(line.name ?? "Item"),
        quantity: Number(line.quantity ?? 1),
        line_total: Number(line.line_total ?? 0),
        options: line.options ?? null,
      }))
    : [];

  return {
    order_id: order.id,
    order_number: shortOrderNumber(order.id),
    restaurant_name: input.restaurantName,
    created_at: order.created_at ?? null,
    items,
    total: Number(order.grand_total ?? order.total ?? 0),
    currency: order.currency ?? null,
    pickup_code: order.pickup_code ?? null,
    dropoff_code: order.dropoff_code ?? null,
    special_instructions: order.leave_at_door ? "Laisser à la porte" : null,
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
    created_at: new Date().toISOString(),
    items: [
      { name: "Burger Classic", quantity: 2, line_total: 24.5 },
      { name: "Frites", quantity: 1, line_total: 4.5 },
    ],
    total: 29,
    currency: "USD",
    pickup_code: "ABC123",
    dropoff_code: "654321",
    special_instructions: "Sans oignons — test impression MMD",
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
