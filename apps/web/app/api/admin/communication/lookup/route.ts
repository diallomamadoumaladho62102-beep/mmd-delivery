import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanSendCommunication } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export async function GET(request: NextRequest) {
  try {
    await assertCanSendCommunication(request);
    const supabase = buildSupabaseAdminClient();
    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();

    if (!q) return json({ ok: false, error: "q required" }, 400);

    if (isUuid(q)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, role")
        .eq("id", q)
        .maybeSingle();

      if (!profile) {
        return json({ ok: true, items: [], hint: "user_not_found" });
      }

      const { data: tokens } = await supabase
        .from("user_push_tokens")
        .select("expo_push_token, role")
        .eq("user_id", q)
        .limit(5);

      const pushTokens = (tokens ?? [])
        .map((row) => String(row.expo_push_token ?? "").trim())
        .filter((token) => token.length > 0);

      return json({
        ok: true,
        items: [
          {
            ...profile,
            has_push_token: pushTokens.length > 0,
            push_token_count: pushTokens.length,
            has_email: Boolean(String(profile.email ?? "").trim()),
            has_phone: Boolean(String(profile.phone ?? "").trim()),
          },
        ],
      });
    }

    const pattern = `%${q}%`;
    const selectCols = "id, full_name, email, phone, role";

    const [byEmail, byName, byPhone] = await Promise.all([
      supabase.from("profiles").select(selectCols).ilike("email", pattern).limit(10),
      supabase.from("profiles").select(selectCols).ilike("full_name", pattern).limit(10),
      supabase.from("profiles").select(selectCols).ilike("phone", pattern).limit(10),
    ]);

    const firstError =
      byEmail.error?.message ?? byName.error?.message ?? byPhone.error?.message;
    if (firstError) return json({ ok: false, error: firstError }, 500);

    const merged = new Map<string, Record<string, unknown>>();
    for (const row of [...(byEmail.data ?? []), ...(byName.data ?? []), ...(byPhone.data ?? [])]) {
      merged.set(String(row.id), row as Record<string, unknown>);
    }
    const data = Array.from(merged.values()).slice(0, 10);

    const ids = data.map((row) => String(row.id));
    let tokenCounts = new Map<string, number>();

    if (ids.length > 0) {
      const { data: tokenRows } = await supabase
        .from("user_push_tokens")
        .select("user_id, expo_push_token")
        .in("user_id", ids);

      for (const row of tokenRows ?? []) {
        const uid = String(row.user_id);
        const token = String(row.expo_push_token ?? "").trim();
        if (!token) continue;
        tokenCounts.set(uid, (tokenCounts.get(uid) ?? 0) + 1);
      }
    }

    const items = data.map((profile) => ({
      ...profile,
      has_push_token: (tokenCounts.get(String(profile.id)) ?? 0) > 0,
      push_token_count: tokenCounts.get(String(profile.id)) ?? 0,
      has_email: Boolean(String(profile.email ?? "").trim()),
      has_phone: Boolean(String(profile.phone ?? "").trim()),
    }));

    return json({ ok: true, items });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
