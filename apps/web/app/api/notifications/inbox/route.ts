import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

type InboxItem = {
  id: string;
  title: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  status: string | null;
  role: string | null;
  sent_at: string | null;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
      : 50;
    const includeArchived =
      req.nextUrl.searchParams.get("include_archived") === "1" ||
      req.nextUrl.searchParams.get("include_archived") === "true";

    let query = auth.supabaseAdmin
      .from("notification_logs")
      .select(
        "id, title, body, data, status, role, sent_at, created_at, read_at, archived_at"
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data: items, error } = await query;
    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const { count: unreadCount, error: countError } = await auth.supabaseAdmin
      .from("notification_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .is("archived_at", null)
      .is("read_at", null);

    if (countError) {
      return taxiJson({ ok: false, error: countError.message }, 500);
    }

    return taxiJson({
      ok: true,
      items: (items ?? []) as InboxItem[],
      unread_count: unreadCount ?? 0,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const action = String(body.action ?? "")
      .trim()
      .toLowerCase();

    if (!UUID_RE.test(id)) {
      return taxiJson({ ok: false, error: "Invalid id" }, 400);
    }

    if (!["read", "unread", "archive", "unarchive"].includes(action)) {
      return taxiJson(
        { ok: false, error: "action must be read|unread|archive|unarchive" },
        400
      );
    }

    const { data: existing, error: findError } = await auth.supabaseAdmin
      .from("notification_logs")
      .select("id, read_at, archived_at")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (findError) {
      return taxiJson({ ok: false, error: findError.message }, 500);
    }
    if (!existing) {
      return taxiJson({ ok: false, error: "not_found" }, 404);
    }

    const now = new Date().toISOString();
    const patch: Record<string, string | null> = {};

    if (action === "read") {
      patch.read_at = existing.read_at ?? now;
    } else if (action === "unread") {
      patch.read_at = null;
    } else if (action === "archive") {
      patch.archived_at = existing.archived_at ?? now;
      patch.read_at = existing.read_at ?? now;
    } else if (action === "unarchive") {
      patch.archived_at = null;
    }

    const { data: updated, error: updateError } = await auth.supabaseAdmin
      .from("notification_logs")
      .update(patch)
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .select("id, read_at, archived_at")
      .maybeSingle();

    if (updateError) {
      return taxiJson({ ok: false, error: updateError.message }, 500);
    }

    return taxiJson({ ok: true, item: updated, action });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
