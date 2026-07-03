import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanModifyPricing } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  PAYMENT_METHOD_SELECT,
  buildAdminPaymentMethodView,
  validatePaymentMethodPatch,
  type PaymentMethodPatchInput,
} from "@/lib/adminPaymentMethods";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PaymentMethodRow } from "@/lib/paymentTypes";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await assertCanModifyPricing(request);
    const { id } = await context.params;
    const paymentMethodId = String(id ?? "").trim();
    if (!paymentMethodId) {
      return json({ ok: false, error: "missing_payment_method_id" }, 400);
    }

    const body = (await request.json().catch(() => ({}))) as PaymentMethodPatchInput;
    const supabase = buildSupabaseAdminClient();

    const { data: existing, error: readErr } = await supabase
      .from("payment_methods")
      .select(PAYMENT_METHOD_SELECT)
      .eq("id", paymentMethodId)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "payment_method_not_found" }, 404);

    const validated = validatePaymentMethodPatch(existing as PaymentMethodRow, body);
    if (validated.ok === false) {
      return json({ ok: false, error: validated.error }, 400);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("payment_methods")
      .update(validated.update)
      .eq("id", paymentMethodId)
      .select(PAYMENT_METHOD_SELECT)
      .single();

    if (updateErr || !updated) {
      return json({ ok: false, error: updateErr?.message ?? "update_failed" }, 500);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "payment_methods.update",
      targetType: "payment_method",
      targetId: paymentMethodId,
      oldValues: existing as Record<string, unknown>,
      newValues: updated as Record<string, unknown>,
      metadata: {
        country_code: existing.country_code,
        method_code: existing.method_code,
      },
      request,
    });

    return json({
      ok: true,
      item: buildAdminPaymentMethodView(updated as PaymentMethodRow),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
