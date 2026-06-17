import type { SupabaseClient } from "@supabase/supabase-js";

export type SecurePushRole = "client" | "driver" | "restaurant";

export type SecurePushContextType = "orders" | "delivery_requests" | "taxi_rides";

export type SecurePushPayload = {
  user_id: string;
  title: string;
  body: string;
  role: SecurePushRole;
  context_type: SecurePushContextType;
  context_id: string;
  data: Record<string, unknown>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeString(value: unknown, field: string, maxLen: number): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${field} is required`);
  if (s.length > maxLen) throw new Error(`${field} too long`);
  return s;
}

function normalizeData(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("data must be an object");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 4000) throw new Error("data too large");
  return value as Record<string, unknown>;
}

export function parseSecurePushSendBody(raw: unknown): SecurePushPayload {
  const body = (raw ?? {}) as Record<string, unknown>;
  const user_id = normalizeString(body.user_id, "user_id", 128);
  const title = normalizeString(body.title, "title", 120);
  const messageBody = normalizeString(body.body ?? body.message, "body", 1000);
  const context_type = normalizeString(body.context_type, "context_type", 64) as
    | SecurePushContextType
    | string;
  const context_id = normalizeString(body.context_id, "context_id", 128);
  const roleRaw = normalizeString(body.role, "role", 32).toLowerCase();

  if (!UUID_RE.test(user_id)) throw new Error("Invalid user_id");
  if (!UUID_RE.test(context_id)) throw new Error("Invalid context_id");

  if (
    context_type !== "orders" &&
    context_type !== "delivery_requests" &&
    context_type !== "taxi_rides"
  ) {
    throw new Error("Invalid context_type");
  }

  if (roleRaw !== "client" && roleRaw !== "driver" && roleRaw !== "restaurant") {
    throw new Error("Invalid role");
  }

  return {
    user_id,
    title,
    body: messageBody,
    role: roleRaw,
    context_type,
    context_id,
    data: normalizeData(body.data),
  };
}

function participantRpc(
  contextType: SecurePushContextType,
  contextId: string,
): { fn: string; args: Record<string, string> } {
  if (contextType === "orders") {
    return { fn: "order_participant_ids", args: { p_order_id: contextId } };
  }
  if (contextType === "delivery_requests") {
    return {
      fn: "delivery_request_participant_ids",
      args: { p_request_id: contextId },
    };
  }
  return { fn: "taxi_ride_participant_ids", args: { p_ride_id: contextId } };
}

export async function assertPushTargetInContext(
  admin: SupabaseClient,
  payload: SecurePushPayload,
): Promise<void> {
  const { fn, args } = participantRpc(payload.context_type, payload.context_id);
  const { data: participants, error } = await admin.rpc(fn, args);

  if (error) {
    console.error("[securePushSend] participant lookup failed", {
      context_type: payload.context_type,
      context_id: payload.context_id,
      message: error.message,
    });
    throw new Error("Context verification failed");
  }

  const participantIds = new Set(
    (participants ?? [])
      .map((row: { user_id?: string | null }) => String(row.user_id ?? ""))
      .filter(Boolean),
  );

  if (!participantIds.has(payload.user_id)) {
    throw new Error("Target user is not a participant of the provided context");
  }

  const table =
    payload.context_type === "orders"
      ? "orders"
      : payload.context_type === "delivery_requests"
        ? "delivery_requests"
        : "taxi_rides";

  const { data: row, error: rowError } = await admin
    .from(table)
    .select("id")
    .eq("id", payload.context_id)
    .maybeSingle();

  if (rowError || !row) {
    throw new Error("Context resource not found");
  }
}
