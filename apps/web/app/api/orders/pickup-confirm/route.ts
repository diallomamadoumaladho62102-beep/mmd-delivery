import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  order_id?: string;
  proof_photo_url?: string | null;
};

type RpcResult = {
  ok?: boolean;
  error?: string;
};

type OrderLinkRow = {
  picked_up_at: string | null;
  status: string | null;
  external_ref_id: string | null;
  external_ref_type: string | null;
};

type OrderNotificationRow = {
  id: string;
  kind: string | null;
  client_user_id: string | null;
  client_id: string | null;
  created_by: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
};

type PushTokenRow = {
  expo_push_token?: string | null;
  push_token?: string | null;
  token?: string | null;
  is_active?: boolean | null;
  disabled?: boolean | null;
};

const ORDER_ID_MAX_LENGTH = 128;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const PROOF_URL_MAX_LENGTH = 2048;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }

  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }

  return "Unknown error";
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Missing order_id");
  }

  if (raw.length > ORDER_ID_MAX_LENGTH) {
    throw new Error("Invalid order_id");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid order_id");
  }

  return raw;
}

function normalizeProofPhotoUrl(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Missing proof_photo_url");
  }

  if (raw.length > PROOF_URL_MAX_LENGTH) {
    throw new Error("Invalid proof_photo_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid proof_photo_url");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Invalid proof_photo_url");
  }

  return parsed.toString();
}

async function parseBody(req: NextRequest): Promise<Body> {
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  const raw = await req.text();

  if (raw.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function mapRpcFailureToHttp(message: string) {
  const normalized = message.trim();

  if (normalized === "Order not found") {
    return { status: 404, error: normalized };
  }

  if (
    normalized === "Forbidden (not assigned driver)" ||
    normalized === "Forbidden"
  ) {
    return { status: 403, error: normalized };
  }

  if (
    normalized === "Order has no driver assigned (cannot confirm pickup)" ||
    normalized === "Commission row not found for order" ||
    normalized === "Invalid order status" ||
    normalized === "Order is not eligible for pickup confirmation"
  ) {
    return { status: 400, error: normalized };
  }

  return { status: 409, error: normalized || "Pickup confirmation failed" };
}

function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^ExponentPushToken\[.+\]$/.test(value.trim())
  );
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

async function persistPickupProof(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  proofPhotoUrl: string;
}) {
  const { supabaseAdmin, orderId, proofPhotoUrl } = params;

  const { data: existingOrder, error: readErr } = await supabaseAdmin
    .from("orders")
    .select("picked_up_at, status, external_ref_id, external_ref_type")
    .eq("id", orderId)
    .maybeSingle<OrderLinkRow>();

  if (readErr) {
    throw new Error(readErr.message || "Failed to load order for pickup proof");
  }

  if (!existingOrder) {
    throw new Error("Order not found while saving pickup proof");
  }

  const updatePayload: {
    pickup_photo_url: string;
    picked_up_at?: string;
  } = {
    pickup_photo_url: proofPhotoUrl,
  };

  if (!existingOrder.picked_up_at) {
    updatePayload.picked_up_at = new Date().toISOString();
  }

  const { error: updateErr } = await supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId);

  if (updateErr) {
    throw new Error(updateErr.message || "Failed to persist pickup proof");
  }

  if (
    existingOrder.external_ref_id &&
    existingOrder.external_ref_type === "delivery_request"
  ) {
    const requestUpdatePayload: {
      status: string;
      updated_at: string;
    } = {
      status: existingOrder.status ?? "accepted",
      updated_at: new Date().toISOString(),
    };

    const { error: requestErr } = await supabaseAdmin
      .from("delivery_requests")
      .update(requestUpdatePayload)
      .eq("id", existingOrder.external_ref_id);

    if (requestErr) {
      throw new Error(
        requestErr.message || "Failed to sync delivery_request after pickup"
      );
    }
  }
}

async function notifyClientPickup(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
}) {
  const { supabaseAdmin, orderId } = params;

  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, kind, client_user_id, client_id, created_by, pickup_address, dropoff_address"
    )
    .eq("id", orderId)
    .maybeSingle<OrderNotificationRow>();

  if (orderErr) {
    throw new Error(orderErr.message || "Failed to load order notification data");
  }

  if (!orderRow) {
    return;
  }

  const recipientIds = dedupeStrings([
    orderRow.client_user_id,
    orderRow.client_id,
    orderRow.created_by,
  ]);

  if (recipientIds.length === 0) {
    return;
  }

  const { data: tokenRows, error: tokenErr } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .in("user_id", recipientIds);

  if (tokenErr) {
    throw new Error(tokenErr.message || "Failed to load user push tokens");
  }

  const tokens = dedupeStrings(
    ((tokenRows ?? []) as PushTokenRow[])
      .filter((row) => row.disabled !== true && row.is_active !== false)
      .map((row) => {
        const candidate =
          row.expo_push_token ?? row.push_token ?? row.token ?? null;
        return isExpoPushToken(candidate) ? candidate : null;
      })
  );

  if (tokens.length === 0) {
    return;
  }

  const pickupText = orderRow.pickup_address?.trim() || "your pickup location";
  const dropoffText =
    orderRow.dropoff_address?.trim() || "the destination";

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Pickup confirmed",
    body: `Your driver picked up the package from ${pickupText} and is heading to ${dropoffText}.`,
    data: {
      type: "pickup_confirmed",
      order_id: orderRow.id,
      kind: orderRow.kind ?? "pickup_dropoff",
    },
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Expo push request failed (${response.status}) ${text}`.trim()
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    const user = userData?.user;

    if (userErr || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await parseBody(req);

    let orderId = "";
    let proofPhotoUrl = "";

    try {
      orderId = normalizeOrderId(body.order_id ?? body.orderId);
    } catch (e) {
      const message = getErrorMessage(e);

      if (message === "Missing order_id") {
        return json({ error: "Missing order_id" }, 400);
      }

      return json({ error: "Invalid order_id" }, 400);
    }

    try {
      proofPhotoUrl = normalizeProofPhotoUrl(body.proof_photo_url);
    } catch (e) {
      const message = getErrorMessage(e);
      if (message === "Missing proof_photo_url") {
        return json({ error: "Missing proof_photo_url" }, 400);
      }
      return json({ error: "Invalid proof_photo_url" }, 400);
    }

    const { data, error } = await supabaseAdmin.rpc("confirm_order_pickup", {
      p_order_id: orderId,
      p_driver_user_id: user.id,
    });

    if (error) {
      console.error("[pickup-confirm] RPC failed", {
        order_id: orderId,
        user_id: user.id,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });

      return json({ error: "Pickup confirmation failed" }, 500);
    }

    const result = (data ?? null) as RpcResult | null;

    if (!result?.ok) {
      const mapped = mapRpcFailureToHttp(result?.error || "");
      return json({ error: mapped.error }, mapped.status);
    }

    try {
      await persistPickupProof({
        supabaseAdmin,
        orderId,
        proofPhotoUrl,
      });
    } catch (persistErr) {
      const persistMessage = getErrorMessage(persistErr);

      console.error("[pickup-confirm] pickup proof persistence failed", {
        order_id: orderId,
        user_id: user.id,
        message: persistMessage,
      });

      return json(
        {
          error: "Pickup confirmed but proof photo could not be saved",
          pickup_confirmed: true,
        },
        500
      );
    }

    try {
      await notifyClientPickup({
        supabaseAdmin,
        orderId,
      });
    } catch (notifyErr) {
      console.error("[pickup-confirm] client notification failed", {
        order_id: orderId,
        user_id: user.id,
        message: getErrorMessage(notifyErr),
      });
    }

    return json({
      ok: true,
      order_id: orderId,
      proof_photo_url: proofPhotoUrl,
      result,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Invalid JSON body") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (message === "Request body too large") {
      return json({ error: "Request body too large" }, 413);
    }

    console.error("[pickup-confirm] fatal error", {
      message,
    });

    return json({ error: "Internal server error" }, 500);
  }
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}