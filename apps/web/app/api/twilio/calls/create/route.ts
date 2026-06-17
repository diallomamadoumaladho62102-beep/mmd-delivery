import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildParticipantRpc,
  getResourceLabel,
  getUserIdByRole,
  parseCreateMaskedCallBody,
  type OrderLikeRow,
  type SourceTable,
} from "@/lib/maskedCallCreate";

export const runtime = "nodejs";

type ProfilePhoneRow = {
  id: string;
  phone: string | null;
  role?: string | null;
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MMD_TWILIO_NUMBER = "+19294924563";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  const value = String(phone ?? "").trim();
  return value.length > 0 ? value : null;
}

async function getProfilePhone(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, phone")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[twilio/calls/create] getProfilePhone error", error);
    return null;
  }

  return normalizePhone((data as ProfilePhoneRow | null)?.phone);
}

async function getAdminProfile(): Promise<ProfilePhoneRow | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, phone, role")
    .eq("role", "admin")
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[twilio/calls/create] getAdminProfile error", error);
    return null;
  }

  const profile = data as ProfilePhoneRow | null;

  if (!profile?.id || !normalizePhone(profile.phone)) {
    return null;
  }

  return profile;
}

function selectColumns(sourceTable: SourceTable): string {
  if (sourceTable === "delivery_requests") {
    return "id, client_user_id, created_by, user_id, driver_id";
  }
  if (sourceTable === "taxi_rides") {
    return "id, client_user_id, driver_id";
  }
  return "id, client_id, client_user_id, created_by, driver_id, restaurant_id";
}

async function loadResourceRow(
  sourceTable: SourceTable,
  resourceId: string,
): Promise<OrderLikeRow | null> {
  const table =
    sourceTable === "delivery_requests"
      ? "delivery_requests"
      : sourceTable === "taxi_rides"
      ? "taxi_rides"
      : "orders";

  const { data, error } = await supabaseAdmin
    .from(table)
    .select(selectColumns(sourceTable))
    .eq("id", resourceId)
    .maybeSingle();

  if (error) {
    console.error("[twilio/calls/create] resource lookup error", {
      sourceTable,
      resourceId,
      message: error.message,
    });
    return null;
  }

  return (data as unknown as OrderLikeRow | null) ?? null;
}

async function isParticipant(
  sourceTable: SourceTable,
  resourceId: string,
  userId: string,
): Promise<boolean> {
  const { fn, args } = buildParticipantRpc(sourceTable, resourceId);
  const { data, error } = await supabaseAdmin.rpc(fn, args);

  if (error) {
    console.error("[twilio/calls/create] participant rpc failed", {
      fn,
      resourceId,
      message: error.message,
    });
    return false;
  }

  return (data ?? []).some(
    (row: { user_id?: string | null }) => String(row.user_id ?? "") === userId,
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Unauthorized", 401);
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return jsonError("Invalid user token", 401);
    }

    const body = await req.json().catch(() => null);
    const parsed = parseCreateMaskedCallBody(body);

    if ("error" in parsed) {
      return jsonError(parsed.error, parsed.status);
    }

    const { resourceId, callerRole, targetRole, sourceTable } = parsed;
    const resourceLabel = getResourceLabel(sourceTable);

    const resource = await loadResourceRow(sourceTable, resourceId);

    if (!resource) {
      return jsonError(`${resourceLabel} not found`, 404);
    }

    const callerUserId: string | null =
      callerRole === "admin" ? user.id : getUserIdByRole(resource, callerRole, sourceTable);

    if (!callerUserId) {
      return jsonError(`Caller user not found for this ${resourceLabel.toLowerCase()}`, 404);
    }

    if (callerRole !== "admin" && callerUserId !== user.id) {
      return jsonError(`You are not allowed to call from this ${resourceLabel.toLowerCase()}`, 403);
    }

    if (callerRole === "admin") {
      const { data: adminProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!adminProfile) {
        return jsonError("Admin access required", 403);
      }
    } else {
      const callerIsParticipant = await isParticipant(
        sourceTable,
        resourceId,
        user.id,
      );

      if (!callerIsParticipant) {
        return jsonError(`You are not allowed to call from this ${resourceLabel.toLowerCase()}`, 403);
      }
    }

    let targetUserId: string | null = null;
    let targetPhone: string | null = null;

    if (targetRole === "admin") {
      const adminProfile = await getAdminProfile();

      if (!adminProfile) {
        return jsonError("Admin phone not found", 404);
      }

      targetUserId = adminProfile.id;
      targetPhone = normalizePhone(adminProfile.phone);
    } else {
      targetUserId = getUserIdByRole(resource, targetRole, sourceTable);

      if (!targetUserId) {
        return jsonError(
          `Target user not found for this ${resourceLabel.toLowerCase()}`,
          404,
        );
      }

      const targetIsParticipant = await isParticipant(
        sourceTable,
        resourceId,
        targetUserId,
      );

      if (!targetIsParticipant) {
        return jsonError(
          `Target user not found for this ${resourceLabel.toLowerCase()}`,
          404,
        );
      }

      targetPhone = await getProfilePhone(targetUserId);
    }

    if (!targetUserId || !targetPhone) {
      return jsonError("Target phone not found", 404);
    }

    const callerPhone = await getProfilePhone(user.id);

    if (!callerPhone) {
      return jsonError("Caller phone not found", 404);
    }

    const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

    const { data: session, error: insertError } = await supabaseAdmin
      .from("call_sessions")
      .insert({
        order_id: resourceId,
        caller_user_id: user.id,
        caller_role: callerRole,
        target_user_id: targetUserId,
        target_role: targetRole,
        proxy_number: MMD_TWILIO_NUMBER,
        caller_phone: callerPhone,
        target_phone: targetPhone,
        expires_at: expiresAt,
        status: "active",
      })
      .select()
      .single();

    if (insertError) {
      console.error("[twilio/calls/create] call session insert error", {
        sourceTable,
        resourceId,
        message: insertError.message,
      });
      return jsonError(insertError.message, 500);
    }

    return NextResponse.json({
      success: true,
      session,
      proxyNumber: MMD_TWILIO_NUMBER,
      sourceTable,
    });
  } catch (error: unknown) {
    console.error("[twilio/calls/create] unhandled", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
