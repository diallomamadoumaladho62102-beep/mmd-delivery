import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractAutomationSettings,
  loadRestaurantAutomationProfile,
} from "@/lib/restaurantOrderAutomation";
import { queueRestaurantPrintJobsForOrder } from "@/lib/restaurantPrintJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

type RouteContext = { params: Promise<{ orderId: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const token = getBearerToken(req);
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

  const { orderId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const source = String(body.source ?? "manual").trim().toLowerCase() === "reprint" ? "reprint" : "manual";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  const supabaseServiceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseUser.auth.getUser();
  const userId = data?.user?.id;
  if (error || !userId) return json({ ok: false, error: "invalid_token" }, 401);

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,restaurant_user_id,restaurant_id,status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return json({ ok: false, error: "order_not_found" }, 404);

  const restaurantUserId = String(order.restaurant_user_id ?? order.restaurant_id ?? "");
  if (restaurantUserId !== userId) return json({ ok: false, error: "forbidden" }, 403);

  const profile = await loadRestaurantAutomationProfile(supabaseAdmin, userId);
  if (!profile) return json({ ok: false, error: "profile_not_found" }, 404);

  const settings = extractAutomationSettings(profile);
  const created = await queueRestaurantPrintJobsForOrder({
    supabaseAdmin,
    restaurantUserId: userId,
    orderId,
    settings,
    source,
  });

  return json({ ok: true, jobs_created: created });
}
