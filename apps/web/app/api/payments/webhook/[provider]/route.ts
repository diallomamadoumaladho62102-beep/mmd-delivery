import { NextRequest } from "next/server";
import { getSupabaseAdminClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { handleProviderWebhook } from "@/lib/paymentWebhookService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  const { provider } = await context.params;

  let body: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      body = Object.fromEntries(form.entries());
    } else {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    }
  } catch {
    body = {};
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await handleProviderWebhook(supabaseAdmin, provider, body, req.headers);
    if (!result.ok) {
      return mmdLocationJson({ ok: false, error: result.error }, result.status);
    }
    return mmdLocationJson({
      ok: true,
      duplicate: "duplicate" in result ? result.duplicate : false,
      payment_id: "payment_id" in result ? result.payment_id : undefined,
      payment_status: "payment_status" in result ? result.payment_status : undefined,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "payment_webhook_failed" },
      500
    );
  }
}
