import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Role = "client" | "driver" | "restaurant" | "admin";

type OrderRow = {
  id: string;
  client_id: string | null;
  driver_id: string | null;
  restaurant_id: string | null;
};

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

const allowedRoles: Role[] = ["client", "driver", "restaurant", "admin"];

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

function isAllowedRole(value: unknown): value is Role {
  return typeof value === "string" && allowedRoles.includes(value as Role);
}

function getOrderUserIdByRole(order: OrderRow, role: Role): string | null {
  if (role === "client") return order.client_id;
  if (role === "driver") return order.driver_id;
  if (role === "restaurant") return order.restaurant_id;
  return null;
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
    console.error("getProfilePhone error", error);
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
    console.error("getAdminProfile error", error);
    return null;
  }

  const profile = data as ProfilePhoneRow | null;

  if (!profile?.id || !normalizePhone(profile.phone)) {
    return null;
  }

  return profile;
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
    const orderId = String(body?.orderId ?? "").trim();
    const callerRole = body?.callerRole;
    const targetRole = body?.targetRole;

    if (!orderId || !callerRole || !targetRole) {
      return jsonError("Missing required fields", 400);
    }

    if (!isAllowedRole(callerRole) || !isAllowedRole(targetRole)) {
      return jsonError("Invalid role", 400);
    }

    if (callerRole === targetRole) {
      return jsonError("Caller and target roles cannot be the same", 400);
    }

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, client_id, driver_id, restaurant_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !orderData) {
      return jsonError("Order not found", 404);
    }

    const order = orderData as OrderRow;

    const callerUserId =
      callerRole === "admin"
        ? user.id
        : getOrderUserIdByRole(order, callerRole);

    if (!callerUserId) {
      return jsonError("Caller user not found for this order", 404);
    }

    if (callerRole !== "admin" && callerUserId !== user.id) {
      return jsonError("You are not allowed to call from this order", 403);
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
      targetUserId = getOrderUserIdByRole(order, targetRole);

      if (!targetUserId) {
        return jsonError("Target user not found for this order", 404);
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
        order_id: orderId,
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
      console.error("call session insert error", insertError);
      return jsonError(insertError.message, 500);
    }

    return NextResponse.json({
      success: true,
      session,
      proxyNumber: MMD_TWILIO_NUMBER,
    });
  } catch (error: any) {
    console.error("twilio create call session error", error);

    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}