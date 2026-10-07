import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import type { AdminPermission } from "@/lib/adminRbac";
import { cancellationReasonLabel, type CancelLocale } from "@/lib/cancellationReasons";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const READ_PERMISSIONS: AdminPermission[] = [
  "orders.read",
  "taxi_rides.read",
  "delivery_requests.read",
];

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function assertCanRead(request: NextRequest) {
  let last: unknown = new AdminAccessError("Forbidden", 403);
  for (const permission of READ_PERMISSIONS) {
    try {
      return await assertStaffPermission(permission, request);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export async function GET(request: NextRequest) {
  try {
    await assertCanRead(request);
    const params = request.nextUrl.searchParams;
    const locale = (["en", "fr", "es", "ar", "zh", "ff"].includes(params.get("locale") ?? "")
      ? params.get("locale")
      : "en") as CancelLocale;
    const admin = buildSupabaseAdminClient();
    let query = admin
      .from("service_cancellations")
      .select(
        "id,entity_type,entity_id,service_type,actor_user_id,actor_role,reason_code,reason_note,created_at,previous_status,resulting_status,wait_minutes,wait_fee_cents,payment_status,refund_amount_cents,acceptance_rate_impact,cancellation_rate_impact,cancellation_source,no_show,post_acceptance,metadata",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    const service = params.get("service");
    const actor = params.get("actor");
    const reason = params.get("reason");
    const entityId = params.get("entity_id");
    const userId = params.get("user_id");
    const from = params.get("from");
    const to = params.get("to");
    if (service) query = query.eq("service_type", service);
    if (actor) query = query.eq("actor_role", actor);
    if (reason) query = query.eq("reason_code", reason);
    if (entityId) query = query.eq("entity_id", entityId);
    if (userId) query = query.eq("actor_user_id", userId);
    if (params.get("no_show") === "1") query = query.eq("no_show", true);
    if (params.get("post_acceptance") === "1") query = query.eq("post_acceptance", true);
    if (params.get("waiting_fee") === "1") query = query.gt("wait_fee_cents", 0);
    if (params.get("payment_status")) query = query.eq("payment_status", params.get("payment_status"));
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = data ?? [];
    const actorIds = [...new Set(rows.map((row) => String(row.actor_user_id ?? "")).filter(Boolean))];
    const profiles = new Map<string, { full_name: string | null; email: string | null; phone: string | null }>();
    if (actorIds.length > 0) {
      const { data: people } = await admin
        .from("profiles")
        .select("id,full_name,email,phone")
        .in("id", actorIds);
      for (const person of people ?? []) {
        profiles.set(String(person.id), {
          full_name: person.full_name ?? null,
          email: person.email ?? null,
          phone: person.phone ?? null,
        });
      }
    }

    return json({
      ok: true,
      cancellations: rows.map((row) => {
        const person = profiles.get(String(row.actor_user_id));
        return {
          ...row,
          reason_label: cancellationReasonLabel(String(row.reason_code ?? ""), locale),
          actor_name: person?.full_name ?? null,
          actor_email: person?.email ?? null,
          actor_phone: person?.phone ?? null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return json({ ok: false, error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
