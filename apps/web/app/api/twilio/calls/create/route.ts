import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MMD_TWILIO_NUMBER = "+19294924563";

const allowedRoles = ["client", "driver", "restaurant", "admin"] as const;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid user token" }, { status: 401 });
    }

    const body = await req.json();

    const { orderId, callerRole, targetRole } = body;

    if (!orderId || !callerRole || !targetRole) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!allowedRoles.includes(callerRole) || !allowedRoles.includes(targetRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (callerRole === targetRole) {
      return NextResponse.json(
        { error: "Caller and target roles cannot be the same" },
        { status: 400 }
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        client_id,
        driver_id,
        restaurant_id
      `
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const callerUserId =
      callerRole === "client"
        ? order.client_id
        : callerRole === "driver"
          ? order.driver_id
          : callerRole === "restaurant"
            ? order.restaurant_id
            : user.id;

    if (callerRole !== "admin" && callerUserId !== user.id) {
      return NextResponse.json(
        { error: "You are not allowed to call from this order" },
        { status: 403 }
      );
    }

    const targetUserId =
      targetRole === "client"
        ? order.client_id
        : targetRole === "driver"
          ? order.driver_id
          : targetRole === "restaurant"
            ? order.restaurant_id
            : null;

    if (!targetUserId) {
      return NextResponse.json(
        { error: "Target user not found for this order" },
        { status: 404 }
      );
    }

    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", targetUserId)
      .single();

    if (targetProfileError || !targetProfile?.phone) {
      return NextResponse.json(
        { error: "Target phone not found" },
        { status: 404 }
      );
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", user.id)
      .single();

    const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

    const { data, error } = await supabaseAdmin
      .from("call_sessions")
      .insert({
        order_id: orderId,
        caller_user_id: user.id,
        caller_role: callerRole,
        target_user_id: targetUserId,
        target_role: targetRole,
        proxy_number: MMD_TWILIO_NUMBER,
        caller_phone: callerProfile?.phone || null,
        target_phone: targetProfile.phone,
        expires_at: expiresAt,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      console.error("call session insert error", error);

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      session: data,
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