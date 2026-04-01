export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await context.params;

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // client user-scoped: pour identifier l'utilisateur courant
  const userSupabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await userSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // service-role: seulement après avoir vérifié que l'utilisateur a le droit
  const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: order, error: orderError } = await adminSupabase
    .from("orders")
    .select("id, created_by, client_user_id, client_id, driver_id, restaurant_id, restaurant_user_id")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 400 });
  }

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const userId = user.id;

  const isDirectMember =
    order.created_by === userId ||
    order.client_user_id === userId ||
    order.client_id === userId ||
    order.driver_id === userId ||
    order.restaurant_id === userId ||
    order.restaurant_user_id === userId;

  let isOrderMember = false;

  if (!isDirectMember) {
    const { data: memberRow, error: memberError } = await adminSupabase
      .from("order_members")
      .select("user_id")
      .eq("order_id", orderId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 400 });
    }

    isOrderMember = !!memberRow;
  }

  if (!isDirectMember && !isOrderMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await adminSupabase
    .from("order_commissions")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}