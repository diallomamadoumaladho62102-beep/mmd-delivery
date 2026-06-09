import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_business.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_business_accounts")
      .select(
        `
        *,
        taxi_business_members (id, user_id, role, active),
        taxi_business_ride_policies (*),
        taxi_business_billing_events (id, amount_cents, event_type, created_at, taxi_ride_id)
      `
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_business.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const name = String(body.name ?? "").trim();
    const billingEmail = String(body.billing_email ?? body.billingEmail ?? "").trim();
    const memberUserId = String(body.member_user_id ?? body.memberUserId ?? "").trim();

    if (!name) return json({ ok: false, error: "Missing name" }, 400);

    const slugBase = slugify(String(body.slug ?? name));
    const slug = slugBase || `business-${Date.now()}`;

    const { data: account, error: accountError } = await supabase
      .from("taxi_business_accounts")
      .insert({
        name,
        slug,
        billing_email: billingEmail || null,
        active: true,
      })
      .select("*")
      .single();

    if (accountError || !account) {
      return json({ ok: false, error: accountError?.message ?? "Insert failed" }, 500);
    }

    await supabase.from("taxi_business_ride_policies").insert({
      business_account_id: account.id,
      max_ride_cents: Number(body.max_ride_cents ?? body.maxRideCents ?? 10000) || null,
      max_daily_cents: Number(body.max_daily_cents ?? body.maxDailyCents ?? 50000) || null,
      max_weekly_cents: Number(body.max_weekly_cents ?? body.maxWeeklyCents ?? 200000) || null,
      requires_manager_approval:
        body.requires_manager_approval === true ||
        body.requiresManagerApproval === true,
      active: true,
    });

    if (memberUserId) {
      await supabase.from("taxi_business_members").insert({
        business_account_id: account.id,
        user_id: memberUserId,
        role: "admin",
        active: true,
      });
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_business_account_created",
      targetType: "taxi_business_account",
      targetId: String(account.id),
      metadata: { name, slug },
      request,
    });

    return json({ ok: true, account });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_business.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const accountId = String(body.id ?? body.account_id ?? "").trim();
    if (!accountId) return json({ ok: false, error: "Missing id" }, 400);

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.active === "boolean") update.active = body.active;
    if (body.name) update.name = String(body.name).trim();
    if (body.billing_email ?? body.billingEmail) {
      update.billing_email = String(body.billing_email ?? body.billingEmail).trim();
    }

    const { data, error } = await supabase
      .from("taxi_business_accounts")
      .update(update)
      .eq("id", accountId)
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_business_account_updated",
      targetType: "taxi_business_account",
      targetId: accountId,
      metadata: update,
      request,
    });

    return json({ ok: true, account: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
