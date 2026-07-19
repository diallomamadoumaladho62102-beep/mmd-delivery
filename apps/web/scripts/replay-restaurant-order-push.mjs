/**
 * Idempotent replay of restaurant new-order push (REST only, no local deps).
 * No payment / settlement side effects.
 *
 *   node --env-file=.env.local scripts/replay-restaurant-order-push.mjs
 */
const ORDER_ID = "3705c677-7fad-498c-b312-14035321ee2f";
const RESTAURANT_ID = "b92dfca2-32f4-424a-bc1b-8f3d9666f565";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEDUP_KEY = `restaurant_new_order:${ORDER_ID}`;
const CHANNEL = "restaurant-orders";
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

const url = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";

function log(...args) {
  console.log(...args);
}

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sbGet(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function sbPost(table, body) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function isExpoPushToken(value) {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

function normalizePlatform(platform) {
  const os = String(platform ?? "").trim().toLowerCase();
  if (os.startsWith("ios") || os.includes("iphone") || os.includes("ipad")) {
    return "ios";
  }
  if (os.startsWith("android")) return "android";
  return "unknown";
}

function soundForPlatform(platform) {
  if (normalizePlatform(platform) === "ios") {
    return "mmd_signature_order_accepted.wav";
  }
  return "mmd_signature_restaurant_120s.wav";
}

async function wasRecentlySent() {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const q =
    `notification_logs?select=id&dedup_key=eq.${encodeURIComponent(DEDUP_KEY)}` +
    `&status=eq.sent&created_at=gte.${encodeURIComponent(since)}&limit=1`;
  const rows = await sbGet(q);
  return Array.isArray(rows) && rows.length > 0;
}

async function notifyOnce() {
  if (await wasRecentlySent()) {
    return { sent: 0, skipped: "dedup" };
  }

  const tokens = await sbGet(
    `user_push_tokens?select=expo_push_token,platform` +
      `&user_id=eq.${RESTAURANT_ID}&role=eq.restaurant`,
  );

  const byToken = new Map();
  for (const row of tokens ?? []) {
    const expo_push_token = String(row.expo_push_token ?? "").trim();
    if (!isExpoPushToken(expo_push_token)) continue;
    byToken.set(expo_push_token, {
      expo_push_token,
      platform: row.platform ?? null,
    });
  }
  const active = [...byToken.values()];

  if (active.length === 0) {
    await sbPost("notification_logs", {
      user_id: RESTAURANT_ID,
      role: "restaurant",
      title: "Nouvelle commande",
      body: "Une commande payée vient d'arriver.",
      data: { type: "restaurant_new_order", order_id: ORDER_ID },
      status: "failed",
      error_message: "no_tokens",
      dedup_key: DEDUP_KEY,
      sent_at: null,
    });
    return { sent: 0, skipped: "no_tokens" };
  }

  const data = {
    type: "restaurant_new_order",
    order_id: ORDER_ID,
    orderId: ORDER_ID,
  };

  const messages = active.map((row) => {
    const platform = normalizePlatform(row.platform);
    return {
      to: row.expo_push_token,
      sound: soundForPlatform(row.platform),
      title: "Nouvelle commande",
      body: "Une commande payée vient d'arriver.",
      data,
      priority: "high",
      channelId:
        platform === "android" || platform === "unknown" ? CHANNEL : undefined,
      _contentAvailable: true,
    };
  });

  let sendOk = false;
  let sendError = null;
  let expoBody = null;
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    expoBody = await response.text().catch(() => "");
    sendOk = response.ok;
    if (!response.ok) sendError = expoBody || "push_failed";
  } catch (e) {
    sendError = e instanceof Error ? e.message : "push_error";
  }

  const status = sendOk ? "sent" : "failed";
  await sbPost("notification_logs", {
    user_id: RESTAURANT_ID,
    role: "restaurant",
    title: "Nouvelle commande",
    body: "Une commande payée vient d'arriver.",
    data,
    status,
    error_message: sendOk ? null : sendError,
    dedup_key: DEDUP_KEY,
    sent_at: sendOk ? new Date().toISOString() : null,
  });

  return {
    sent: sendOk ? active.length : 0,
    skipped: sendOk ? undefined : "send_failed",
    sendError,
    expoBody,
    tokenCount: active.length,
  };
}

async function main() {
  const orders = await sbGet(
    `orders?select=id,status,payment_status,kind,restaurant_user_id,restaurant_id,created_at,restaurant_accept_expires_at` +
      `&id=eq.${ORDER_ID}&limit=1`,
  );
  log("ORDER", JSON.stringify(orders?.[0] ?? null));

  const tokens = await sbGet(
    `user_push_tokens?select=user_id,role,platform,expo_push_token,updated_at` +
      `&user_id=eq.${RESTAURANT_ID}&role=eq.restaurant`,
  );
  log(
    "TOKENS",
    JSON.stringify(
      (tokens ?? []).map((t) => ({
        role: t.role,
        platform: t.platform,
        updated_at: t.updated_at,
        token_prefix: String(t.expo_push_token ?? "").slice(0, 28),
      })),
      null,
      2,
    ),
  );

  const prior = await sbGet(
    `notification_logs?select=id,status,dedup_key,error_message,created_at,sent_at` +
      `&dedup_key=eq.${encodeURIComponent(DEDUP_KEY)}` +
      `&order=created_at.desc&limit=5`,
  );
  log("PRIOR_LOGS", JSON.stringify(prior ?? [], null, 2));

  const first = await notifyOnce();
  log("REPLAY_1", JSON.stringify(first));
  const second = await notifyOnce();
  log("REPLAY_2", JSON.stringify(second));

  const after = await sbGet(
    `notification_logs?select=id,status,dedup_key,error_message,created_at,sent_at` +
      `&dedup_key=eq.${encodeURIComponent(DEDUP_KEY)}` +
      `&order=created_at.desc&limit=5`,
  );
  log("AFTER_LOGS", JSON.stringify(after ?? [], null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
