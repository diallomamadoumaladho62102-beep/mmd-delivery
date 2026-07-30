import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Business wallet transaction history (ledger + domain entries).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const businessAccountId =
      req.nextUrl.searchParams.get("business_account_id")?.trim() || "";
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.round(limitRaw), 1), 100)
      : 50;

    let query = auth.supabaseAdmin
      .from("taxi_business_members")
      .select("business_account_id,role")
      .eq("user_id", auth.user.id)
      .eq("active", true);

    if (businessAccountId) {
      query = query.eq("business_account_id", businessAccountId);
    }

    const { data: membership, error: memErr } = await query.limit(1).maybeSingle();
    if (memErr) return taxiJson({ ok: false, error: memErr.message }, 500);
    if (!membership?.business_account_id) {
      return taxiJson({ ok: false, error: "business_membership_required" }, 403);
    }

    const accountId = String(membership.business_account_id);

    const { data: entries, error } = await auth.supabaseAdmin
      .from("taxi_business_wallet_entries")
      .select(
        "id,direction,amount_cents,currency,entry_type,reference_type,reference_id,stripe_payment_intent_id,stripe_transfer_id,description,metadata,created_at"
      )
      .eq("business_account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const items = (entries ?? []).map((row) => {
      const entryType = String(row.entry_type ?? "");
      let status = "posted";
      if (entryType === "cashout") status = row.stripe_transfer_id ? "paid" : "processing";
      if (entryType === "topup") status = row.stripe_payment_intent_id ? "paid" : "pending";
      if (entryType === "ride_debit") status = "paid";
      if (entryType === "ride_refund") status = "refunded";

      return {
        id: row.id,
        direction: row.direction,
        amount_cents: Number(row.amount_cents ?? 0),
        currency: String(row.currency ?? "USD"),
        entry_type: entryType,
        status,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        description: row.description,
        stripe_payment_intent_id: row.stripe_payment_intent_id,
        stripe_transfer_id: row.stripe_transfer_id,
        created_at: row.created_at,
      };
    });

    return taxiJson({
      ok: true,
      business_account_id: accountId,
      role: membership.role,
      items,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
