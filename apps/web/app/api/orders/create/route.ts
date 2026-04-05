import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type LegacyBody = {
  orderId?: string;
  order_id?: string;
  lineItems?: unknown[];
  successUrl?: string;
  cancelUrl?: string;
};

type UpstreamJson = {
  url?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  checkoutUrl?: unknown;
  error?: unknown;
  message?: unknown;
};

const ORDER_ID_MAX_LENGTH = 128;
const INTERNAL_FORWARD_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > ORDER_ID_MAX_LENGTH) {
    throw new Error("Invalid orderId");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid orderId");
  }

  return raw;
}

function getInternalTargetUrl(req: NextRequest): string {
  return new URL("/api/stripe/client/create-checkout-session", req.url).toString();
}

function buildJsonResponse(
  payload: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function buildSafeErrorResponse(
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return buildJsonResponse(
    {
      error: message,
      ...(extra ?? {}),
    },
    status
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort"))
  );
}

function pickSafeUpstreamPayload(value: unknown): Record<string, unknown> {
  const payload: UpstreamJson =
    value && typeof value === "object" ? (value as UpstreamJson) : {};

  const safe: Record<string, unknown> = {};

  if (typeof payload.url === "string" && payload.url.trim()) {
    safe.url = payload.url;
  }

  if (typeof payload.checkoutUrl === "string" && payload.checkoutUrl.trim()) {
    safe.checkoutUrl = payload.checkoutUrl;
  }

  if (typeof payload.sessionId === "string" && payload.sessionId.trim()) {
    safe.sessionId = payload.sessionId;
  } else if (
    typeof payload.session_id === "string" &&
    payload.session_id.trim()
  ) {
    safe.sessionId = payload.session_id;
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    safe.error = payload.error;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    safe.message = payload.message;
  }

  return safe;
}

async function readJsonBody(req: NextRequest): Promise<LegacyBody> {
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    throw new Error("Request body too large");
  }

  const rawText = await req.text();

  if (rawText.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  if (!rawText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LegacyBody) : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);

    let orderId = "";
    try {
      orderId = normalizeOrderId(body.orderId ?? body.order_id);
    } catch {
      return buildSafeErrorResponse("Invalid orderId", 400, {
        hint: "This legacy route requires a valid existing orderId/order_id.",
      });
    }

    if (!orderId) {
      return buildSafeErrorResponse("Missing orderId", 400, {
        hint: "This legacy route now requires an existing orderId/order_id.",
      });
    }

    const targetUrl = getInternalTargetUrl(req);

    const cookieHeader = req.headers.get("cookie");
    const authorizationHeader = req.headers.get("authorization");
    const xRequestId = req.headers.get("x-request-id");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INTERNAL_FORWARD_TIMEOUT_MS);

    let upstreamRes: Response;

    try {
      upstreamRes = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
          ...(xRequestId ? { "X-Request-Id": xRequestId } : {}),
        },
        body: JSON.stringify({
          order_id: orderId,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return buildSafeErrorResponse(
          "Upstream checkout request timed out",
          504
        );
      }

      console.error("[orders/create] compat forward failed");
      return buildSafeErrorResponse(
        "Unable to forward checkout request",
        502
      );
    } finally {
      clearTimeout(timeout);
    }

    const upstreamContentType = upstreamRes.headers.get("content-type") || "";
    const isJson = upstreamContentType.toLowerCase().includes("application/json");

    let upstreamData: unknown = {};
    if (isJson) {
      upstreamData = await upstreamRes.json().catch(() => ({}));
    }

    const safePayload = pickSafeUpstreamPayload(upstreamData);

    return buildJsonResponse(
      {
        ...safePayload,
        legacy_route: true,
        source_route: "/api/orders/create",
        forwarded_to: "/api/stripe/client/create-checkout-session",
        ignored_legacy_fields: {
          lineItems: Array.isArray(body.lineItems) ? body.lineItems.length : 0,
          successUrl: Boolean(body.successUrl),
          cancelUrl: Boolean(body.cancelUrl),
        },
      },
      upstreamRes.status
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "Invalid JSON body") {
        return buildSafeErrorResponse("Invalid JSON body", 400);
      }

      if (error.message === "Request body too large") {
        return buildSafeErrorResponse("Request body too large", 413);
      }
    }

    console.error("[orders/create] compat wrapper error");
    return buildSafeErrorResponse("Checkout creation failed", 500);
  }
}

export async function GET() {
  return buildSafeErrorResponse("Method not allowed", 405);
}

export async function PUT() {
  return buildSafeErrorResponse("Method not allowed", 405);
}

export async function PATCH() {
  return buildSafeErrorResponse("Method not allowed", 405);
}

export async function DELETE() {
  return buildSafeErrorResponse("Method not allowed", 405);
}