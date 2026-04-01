import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  order_id?: string;
  orderId?: string;
};

type GenericErrorLike = {
  message?: unknown;
};

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }

  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as GenericErrorLike).message === "string"
  ) {
    return (value as GenericErrorLike).message as string;
  }

  return "Server error";
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function extractBearerHeader(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.trim() ? auth : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const orderId = String(body.order_id ?? body.orderId ?? "").trim();

    if (!orderId) {
      return json({ error: "order_id required" }, 400);
    }

    const authHeader = extractBearerHeader(req);
    const url = new URL(req.url);
    const base = url.origin;

    const response = await fetch(
      `${base}/api/stripe/client/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({ order_id: orderId }),
        cache: "no-store",
      }
    );

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    return NextResponse.json(data, { status: response.status });
  } catch (err: unknown) {
    console.error("[stripe/client/checkout] wrapper error", {
      message: getErrorMessage(err),
    });

    return json({ error: getErrorMessage(err) }, 500);
  }
}