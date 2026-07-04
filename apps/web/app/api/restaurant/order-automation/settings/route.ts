import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractAutomationSettings,
  loadRestaurantAutomationProfile,
} from "@/lib/restaurantOrderAutomation";
import { DEFAULT_RESTAURANT_AUTOMATION_SETTINGS } from "@/lib/restaurantOrderAutomationTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

async function requireRestaurant(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, response: json({ ok: false, error: "missing_token" }, 401) };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) {
    return { ok: false as const, response: json({ ok: false, error: "invalid_token" }, 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (String(profile?.role ?? "").toLowerCase() !== "restaurant") {
    return { ok: false as const, response: json({ ok: false, error: "forbidden" }, 403) };
  }

  return { ok: true as const, userId: user.id, supabaseAdmin };
}

export async function GET(req: NextRequest) {
  const auth = await requireRestaurant(req);
  if (auth.ok === false) return auth.response;

  const profile = await loadRestaurantAutomationProfile(auth.supabaseAdmin, auth.userId);
  const settings = extractAutomationSettings(profile ?? DEFAULT_RESTAURANT_AUTOMATION_SETTINGS);

  return json({ ok: true, settings, opening_hours: profile?.opening_hours ?? null });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRestaurant(req);
  if (auth.ok === false) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const boolFields = [
    "auto_accept_orders_enabled",
    "auto_accept_only_during_hours",
    "auto_pause_when_closed",
    "auto_pause_when_busy",
    "auto_print_enabled",
    "print_kitchen_ticket",
    "print_customer_ticket",
    "print_driver_ticket",
    "print_show_qr_code",
    "print_special_instructions",
  ] as const;

  for (const key of boolFields) {
    if (body[key] !== undefined) patch[key] = Boolean(body[key]);
  }

  if (body.default_prep_minutes !== undefined) {
    patch.default_prep_minutes = Math.min(180, Math.max(1, Number(body.default_prep_minutes)));
  }
  if (body.busy_order_threshold !== undefined) {
    patch.busy_order_threshold = Math.min(200, Math.max(1, Number(body.busy_order_threshold)));
  }
  if (body.print_copies !== undefined) {
    patch.print_copies = Math.min(5, Math.max(1, Number(body.print_copies)));
  }
  if (body.print_paper_width !== undefined) {
    patch.print_paper_width = String(body.print_paper_width) === "58mm" ? "58mm" : "80mm";
  }

  const { data, error } = await auth.supabaseAdmin
    .from("restaurant_profiles")
    .update(patch)
    .eq("user_id", auth.userId)
    .select("*")
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, settings: extractAutomationSettings(data) });
}
