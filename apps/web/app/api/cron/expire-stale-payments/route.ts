import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import {
  EXPIRE_STALE_PAYMENTS_JOB,
  runExpireStalePayments,
} from "@/lib/expireStalePayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase admin env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStripe(): Stripe | null {
  const key = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

function readDryRun(req: NextRequest): boolean {
  const fromEnv =
    String(process.env.EXPIRE_STALE_PAYMENTS_DRY_RUN ?? "")
      .trim()
      .toLowerCase() === "true";
  const urlFlag = req.nextUrl.searchParams.get("dry_run");
  if (urlFlag === "1" || urlFlag === "true") return true;
  if (urlFlag === "0" || urlFlag === "false") return false;
  return fromEnv;
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const dryRun = readDryRun(req);
  const supabaseAdmin = getSupabaseAdmin();

  const locked = await withCronJobLock(
    supabaseAdmin,
    EXPIRE_STALE_PAYMENTS_JOB,
    async () =>
      runExpireStalePayments({
        supabaseAdmin,
        stripe: getStripe(),
        dryRun,
      }),
    { ttlSeconds: 10 * 60 }
  );

  if (!locked.ok) {
    // Contended run is not a hard failure — another worker holds the lease.
    return json({
      ok: true,
      skipped: true,
      reason: "lock_busy",
      job: EXPIRE_STALE_PAYMENTS_JOB,
      locked_by: locked.lockedBy ?? null,
    });
  }

  return json(locked.result);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
