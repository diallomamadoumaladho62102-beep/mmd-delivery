/// Shared server-only auth + validation for Edge push senders.

export type PushRole = "driver" | "restaurant";

export type SecurePushPayload = {
  user_id: string;
  title: string;
  message: string;
  role: PushRole;
  context_type: "orders" | "delivery_requests" | "taxi_rides";
  context_id: string;
  data?: Record<string, unknown>;
};

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_RE = USER_ID_RE;

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export function assertInternalPushCaller(req: Request): void {
  const pushKey = String(Deno.env.get("PUSH_API_KEY") ?? "").trim();
  const cronSecret = String(Deno.env.get("CRON_SECRET") ?? "").trim();
  const providedKey = String(req.headers.get("x-api-key") ?? "").trim();
  const providedCron = String(req.headers.get("x-cron-secret") ?? "").trim();

  if (pushKey && providedKey && timingSafeEqual(providedKey, pushKey)) {
    return;
  }

  if (cronSecret && providedCron && timingSafeEqual(providedCron, cronSecret)) {
    return;
  }

  throw new Response(
    JSON.stringify({ ok: false, error: "Unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function normalizeString(
  value: unknown,
  field: string,
  maxLen: number,
): string {
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

export function parseSecurePushBody(
  raw: unknown,
  expectedRole: PushRole,
): SecurePushPayload {
  const body = (raw ?? {}) as Record<string, unknown>;
  const user_id = normalizeString(body.user_id, "user_id", 128);
  const title = normalizeString(body.title, "title", 120);
  const message = normalizeString(body.message ?? body.body, "message", 1000);
  const context_type = normalizeString(body.context_type, "context_type", 64) as
    | "orders"
    | "delivery_requests"
    | "taxi_rides";
  const context_id = normalizeString(body.context_id, "context_id", 128);

  if (!USER_ID_RE.test(user_id)) throw new Error("Invalid user_id");
  if (!UUID_RE.test(context_id)) throw new Error("Invalid context_id");

  if (
    context_type !== "orders" &&
    context_type !== "delivery_requests" &&
    context_type !== "taxi_rides"
  ) {
    throw new Error("Invalid context_type");
  }

  const roleRaw = String(body.role ?? expectedRole).trim().toLowerCase();
  if (roleRaw !== expectedRole) {
    throw new Error(`Invalid role (expected ${expectedRole})`);
  }

  return {
    user_id,
    title,
    message,
    role: expectedRole,
    context_type,
    context_id,
    data: normalizeData(body.data),
  };
}

type SupabaseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, string>,
  ) => Promise<{ data: { user_id: string }[] | null; error: { message: string } | null }>;
};

export async function assertPushTargetInContext(
  admin: SupabaseAdmin,
  payload: SecurePushPayload,
): Promise<void> {
  const { data: participants, error } = await admin.rpc(
    payload.context_type === "orders"
      ? "order_participant_ids"
      : payload.context_type === "delivery_requests"
      ? "delivery_request_participant_ids"
      : "taxi_ride_participant_ids",
    payload.context_type === "orders"
      ? { p_order_id: payload.context_id }
      : payload.context_type === "delivery_requests"
      ? { p_request_id: payload.context_id }
      : { p_ride_id: payload.context_id },
  );

  if (error) {
    console.error("[securePush] participant lookup failed", {
      context_type: payload.context_type,
      context_id: payload.context_id,
      message: error.message,
    });
    throw new Error("Context verification failed");
  }

  const participantIds = new Set(
    (participants ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean),
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
