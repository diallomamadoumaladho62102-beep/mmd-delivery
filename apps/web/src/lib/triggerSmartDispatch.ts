import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";

export type SmartDispatchResult = {
  ok: boolean;
  status?: number;
  result?: unknown;
  error?: string;
};

export async function triggerSmartDispatchForOrder(params: {
  origin: string;
  orderId: string;
  wave?: number;
}): Promise<SmartDispatchResult> {
  const { origin, orderId, wave = 1 } = params;

  try {
    const url = new URL("/api/dispatch/smart", origin);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildDispatchInternalHeaders(),
      },
      body: JSON.stringify({ orderId, order_id: orderId, wave }),
      cache: "no-store",
    });

    const out = await res.json().catch(() => null);

    return {
      ok: res.ok,
      status: res.status,
      result: out,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Smart dispatch failed";
    console.log("Smart dispatch error:", message);

    return {
      ok: false,
      error: message,
    };
  }
}
