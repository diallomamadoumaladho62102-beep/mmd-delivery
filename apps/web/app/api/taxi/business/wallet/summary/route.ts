import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  executeBusinessWalletCashout,
  getBusinessWalletBalance,
} from "@/lib/taxiBusinessWalletService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveBusinessAccountId(
  auth: Awaited<ReturnType<typeof requireTaxiApiUser>> & { ok: true },
  requestedId: string | null
): Promise<{ id: string; role: string } | { error: string; status: number }> {
  let query = auth.supabaseAdmin
    .from("taxi_business_members")
    .select("business_account_id,role")
    .eq("user_id", auth.user.id)
    .eq("active", true);

  if (requestedId) {
    query = query.eq("business_account_id", requestedId);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data?.business_account_id) {
    return { error: "business_membership_required", status: 403 };
  }
  return {
    id: String(data.business_account_id),
    role: String(data.role ?? "employee"),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const businessAccountId = req.nextUrl.searchParams.get("business_account_id");
    const resolved = await resolveBusinessAccountId(auth, businessAccountId);
    if ("error" in resolved) {
      return taxiJson({ ok: false, error: resolved.error }, resolved.status);
    }

    const { data: account } = await auth.supabaseAdmin
      .from("taxi_business_accounts")
      .select(
        "id,name,currency,country_code,stripe_account_id,stripe_onboarding_status,stripe_payouts_enabled,stripe_charges_enabled,stripe_details_submitted"
      )
      .eq("id", resolved.id)
      .maybeSingle();

    const currency = String(account?.currency ?? "USD");
    const balanceCents = await getBusinessWalletBalance(
      auth.supabaseAdmin,
      resolved.id,
      currency
    );

    return taxiJson({
      ok: true,
      account_type: "business",
      business_account_id: resolved.id,
      role: resolved.role,
      currency,
      balance_cents: balanceCents,
      available_cents: balanceCents,
      can_manage: ["manager", "admin"].includes(resolved.role),
      can_topup: ["manager", "admin"].includes(resolved.role),
      can_cashout:
        ["manager", "admin"].includes(resolved.role) &&
        Boolean(account?.stripe_account_id) &&
        Boolean(account?.stripe_payouts_enabled),
      connect: {
        stripe_account_id: account?.stripe_account_id ?? null,
        stripe_onboarding_status: account?.stripe_onboarding_status ?? null,
        stripe_payouts_enabled: account?.stripe_payouts_enabled ?? false,
        stripe_charges_enabled: account?.stripe_charges_enabled ?? false,
        stripe_details_submitted: account?.stripe_details_submitted ?? false,
      },
      account: account
        ? { id: account.id, name: account.name, currency: account.currency }
        : null,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "cashout").trim().toLowerCase();
    const businessAccountId = String(body.business_account_id ?? "").trim() || null;
    const resolved = await resolveBusinessAccountId(auth, businessAccountId);
    if ("error" in resolved) {
      return taxiJson({ ok: false, error: resolved.error }, resolved.status);
    }
    if (!["manager", "admin"].includes(resolved.role)) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }

    if (action !== "cashout") {
      return taxiJson({ ok: false, error: "unsupported_action" }, 400);
    }

    const amountCents = Math.round(Number(body.amount_cents ?? 0));
    const result = await executeBusinessWalletCashout(auth.supabaseAdmin, {
      businessAccountId: resolved.id,
      amountCents,
      currency: body.currency ? String(body.currency) : undefined,
    });

    if (result.ok === false) {
      return taxiJson({ ok: false, error: result.error }, 400);
    }

    return taxiJson({ ok: true, ...result });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
