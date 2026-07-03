import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { initiateLocalPayment } from "@/lib/paymentInitiateService";
import type { PaymentEntityType } from "@/lib/paymentTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  entity_type?: PaymentEntityType;
  entity_id?: string;
  method_code?: string;
  country_code?: string;
  payer_phone?: string;
};

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return mmdLocationJson({ ok: false, error: "invalid_json" }, 400);
  }

  const entityType = String(body.entity_type ?? "").trim() as PaymentEntityType;
  const entityId = String(body.entity_id ?? "").trim();
  const methodCode = String(body.method_code ?? "").trim();

  if (!entityType || !entityId || !methodCode) {
    return mmdLocationJson({ ok: false, error: "entity_type_entity_id_method_code_required" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await initiateLocalPayment(supabaseAdmin, {
      entityType,
      entityId,
      methodCode,
      countryCode: body.country_code ?? null,
      payerPhone: body.payer_phone ?? null,
      userId: data.user.id,
    });

    if (!result.ok) {
      const status =
        result.error === "forbidden"
          ? 403
          : result.error === "already_paid"
            ? 409
            : result.error === "payment_method_unavailable"
              ? 503
              : 400;
      return mmdLocationJson(
        {
          ok: false,
          error: result.error,
          message: "message" in result ? result.message : undefined,
        },
        status
      );
    }

    return mmdLocationJson({
      ok: true,
      payment_id: result.payment?.id,
      status: result.payment?.status,
      payment_url: result.payment?.payment_url,
      provider: result.payment?.provider,
      method_code: result.payment?.method_code,
      external_reference: result.payment?.external_reference,
      method: result.method,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "payment_initiate_failed" },
      500
    );
  }
}
