import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractAutomationSettings,
  loadRestaurantAutomationProfile,
} from "@/lib/restaurantOrderAutomation";
import { queueRestaurantTestPrintJob } from "@/lib/restaurantPrintJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

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
  const userId = data?.user?.id;
  if (error || !userId) return json({ ok: false, error: "invalid_token" }, 401);

  const profile = await loadRestaurantAutomationProfile(supabaseAdmin, userId);
  if (!profile) return json({ ok: false, error: "profile_not_found" }, 404);

  const settings = extractAutomationSettings(profile);
  const jobId = await queueRestaurantTestPrintJob({
    supabaseAdmin,
    restaurantUserId: userId,
    settings,
  });

  if (!jobId) return json({ ok: false, error: "test_print_failed" }, 500);
  return json({ ok: true, job_id: jobId });
}
