import { NextRequest } from "next/server";
import {
  AdminAccessError,
  assertCanReviewRestaurants,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  extractAutomationSettings,
  loadRestaurantAutomationProfile,
} from "@/lib/restaurantOrderAutomation";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    await assertCanReviewRestaurants(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const userId = new URL(req.url).searchParams.get("userId")?.trim();
  if (!userId) return adminJson({ ok: false, error: "userId_required" }, 400);

  const admin = buildSupabaseAdminClient();
  const profile = await loadRestaurantAutomationProfile(admin, userId);
  if (!profile) return adminJson({ ok: false, error: "not_found" }, 404);

  return adminJson({
    ok: true,
    settings: extractAutomationSettings(profile),
    restaurant_name: profile.restaurant_name,
    opening_hours: profile.opening_hours,
  });
}

export async function PATCH(req: NextRequest) {
  let staff;
  try {
    staff = await assertCanReviewRestaurants(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = String(body.userId ?? "").trim();
  if (!userId) return adminJson({ ok: false, error: "userId_required" }, 400);

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

  const admin = buildSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurant_profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) return adminJson({ ok: false, error: error.message }, 500);

  await writeAdminAuditServer({
    supabaseAdmin: admin,
    adminUserId: staff.userId,
    action: "restaurant_automation.update",
    targetType: "restaurant_profile",
    targetId: userId,
    metadata: patch,
    request: req,
  });

  return adminJson({ ok: true, settings: extractAutomationSettings(data) });
}
