import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveDispatchAccess } from "@/lib/dispatchInternalAuth";
import { runDeliveryRequestDispatch } from "@/lib/runDeliveryRequestDispatch";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { resolveDeliveryRequestPlatformCountry } from "@/lib/platformCountryResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function assertUserMayDispatchDeliveryRequest(params: {
  access: { mode: "internal" } | { mode: "user"; userId: string; role: string };
  request: {
    created_by?: unknown;
    client_user_id?: unknown;
  };
}): { ok: true } | { ok: false; status: number; error: string } {
  if (params.access.mode === "internal") {
    return { ok: true };
  }

  const { userId, role } = params.access;
  const normalizedRole = normalize(role);

  if (normalizedRole === "admin" || normalizedRole === "ops") {
    return { ok: true };
  }

  if (normalizedRole === "client") {
    const ownerId = String(
      params.request.client_user_id ?? params.request.created_by ?? ""
    ).trim();

    if (ownerId && ownerId === userId) {
      return { ok: true };
    }

    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const deliveryRequestId = String(
      body.deliveryRequestId ?? body.delivery_request_id ?? ""
    ).trim();

    const requestedWave = Math.min(Math.max(Number(body.wave ?? 1), 1), 3);
    const locationFreshMinutes = Math.min(
      Number(body.locationFreshMinutes ?? 20),
      120
    );

    if (!deliveryRequestId) {
      return json({ error: "Missing deliveryRequestId" }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const accessResult = await resolveDispatchAccess(req, supabase);
    if (accessResult.ok === false) {
      return json({ error: accessResult.error }, accessResult.status);
    }

    const { data: request, error: requestError } = await supabase
      .from("delivery_requests")
      .select("id,created_by,client_user_id,payment_status,status,driver_id,currency,pickup_lat,pickup_lng")
      .eq("id", deliveryRequestId)
      .maybeSingle();

    if (requestError) {
      return json({ error: requestError.message }, 500);
    }

    if (!request) {
      return json({ error: "Delivery request not found" }, 404);
    }

    const scopeResult = assertUserMayDispatchDeliveryRequest({
      access: accessResult.access,
      request,
    });

    if (scopeResult.ok === false) {
      return json({ error: scopeResult.error }, scopeResult.status);
    }

    const drCountry = resolveDeliveryRequestPlatformCountry(request);
    const platformCheck = await assertPlatformFeature(
      supabase,
      drCountry,
      "delivery",
      "active"
    );
    if (platformCheck.ok === false) {
      return json(
        {
          ok: false,
          error: platformCheck.error,
          message: platformCheck.message,
          country_code: platformCheck.country_code,
        },
        403
      );
    }

    const result = await runDeliveryRequestDispatch({
      supabase,
      deliveryRequestId,
      wave: requestedWave,
      locationFreshMinutes,
    });

    if (!result.ok) {
      return json(
        {
          ok: false,
          deliveryRequestId,
          error: result.error ?? "Dispatch failed",
        },
        500
      );
    }

    return json({
      ok: true,
      ...result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
