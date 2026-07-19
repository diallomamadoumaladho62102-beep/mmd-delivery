import { NextRequest, NextResponse } from "next/server";
import { requireSellerApiUser } from "@/lib/sellerLoyaltyAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, sellerUserId } = auth.ctx;

    const [{ data: campaigns }, { data: requests }] = await Promise.all([
      admin
        .from("marketing_campaigns")
        .select("id, code, name, status, campaign_type, starts_at, ends_at, budget_total_cents, budget_spent_cents, funder")
        .eq("partner_type", "seller")
        .eq("partner_user_id", sellerUserId)
        .order("updated_at", { ascending: false })
        .limit(50),
      admin
        .from("marketing_partner_requests")
        .select("*")
        .eq("partner_type", "seller")
        .eq("partner_user_id", sellerUserId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return NextResponse.json({
      ok: true,
      campaigns: campaigns ?? [],
      requests: requests ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSellerApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, sellerUserId } = auth.ctx;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    if (!title) return NextResponse.json({ ok: false, error: "Missing title" }, { status: 400 });

    const { data, error } = await admin
      .from("marketing_partner_requests")
      .insert({
        partner_type: "seller",
        partner_user_id: sellerUserId,
        title,
        description: typeof body.description === "string" ? body.description : null,
        proposed_budget_cents:
          body.proposed_budget_cents == null
            ? null
            : Math.round(Number(body.proposed_budget_cents)),
        starts_at: body.starts_at ? String(body.starts_at) : null,
        ends_at: body.ends_at ? String(body.ends_at) : null,
        status: "pending",
        metadata: { products: body.products ?? null },
      })
      .select("*")
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, request: data });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
