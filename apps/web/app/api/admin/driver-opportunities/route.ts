import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const OPPORTUNITY_SELECT =
  "id, category, title, subtitle, starts_at, ends_at, lat, lng, bonus_cents, currency, capacity, status, created_at, updated_at";

const CATEGORIES = new Set([
  "promotions",
  "airports",
  "reservations",
  "events",
] as const);

const STATUSES = new Set(["draft", "published", "archived"] as const);

type Category = (typeof CATEGORIES extends Set<infer T> ? T : never);
type Status = (typeof STATUSES extends Set<infer T> ? T : never);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function parseCategory(value: unknown): Category | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return CATEGORIES.has(v as Category) ? (v as Category) : null;
}

function parseStatus(value: unknown, fallback?: Status): Status | null {
  if (value == null || value === "") return fallback ?? null;
  const v = String(value).trim().toLowerCase();
  return STATUSES.has(v as Status) ? (v as Status) : null;
}

function parseOptionalIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: unknown): number | null {
  const n = parseOptionalNumber(value);
  if (n == null) return null;
  return Math.round(n);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 200), 1),
      500
    );

    const { data, error } = await supabase
      .from("driver_opportunities")
      .select(OPPORTUNITY_SELECT)
      .order("created_at", { ascending: false })
      .limit(limit);

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
    await assertStaffPermission("users.drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const category = parseCategory(body.category);
    const title = String(body.title ?? "").trim();
    const status = parseStatus(body.status, "draft");

    if (!category) {
      return json({ ok: false, error: "Invalid category" }, 400);
    }
    if (!title) {
      return json({ ok: false, error: "Title is required" }, 400);
    }
    if (!status) {
      return json({ ok: false, error: "Invalid status" }, 400);
    }

    const lat = parseOptionalNumber(body.lat);
    const lng = parseOptionalNumber(body.lng);
    if ((lat == null) !== (lng == null)) {
      return json(
        { ok: false, error: "lat and lng must both be set or both omitted" },
        400
      );
    }
    if (lat != null && (lat < -90 || lat > 90)) {
      return json({ ok: false, error: "Invalid lat" }, 400);
    }
    if (lng != null && (lng < -180 || lng > 180)) {
      return json({ ok: false, error: "Invalid lng" }, 400);
    }

    const capacity = parseOptionalInt(body.capacity);
    if (capacity != null && capacity <= 0) {
      return json({ ok: false, error: "Capacity must be positive" }, 400);
    }

    const bonusCents =
      body.bonus_cents != null ? Math.round(Number(body.bonus_cents)) : 0;
    if (!Number.isFinite(bonusCents) || bonusCents < 0) {
      return json({ ok: false, error: "Invalid bonus_cents" }, 400);
    }

    const row = {
      category,
      title,
      subtitle:
        typeof body.subtitle === "string" && body.subtitle.trim()
          ? body.subtitle.trim()
          : null,
      starts_at: parseOptionalIso(body.starts_at),
      ends_at: parseOptionalIso(body.ends_at),
      lat,
      lng,
      bonus_cents: bonusCents,
      currency:
        typeof body.currency === "string" && body.currency.trim()
          ? body.currency.trim().toUpperCase()
          : "USD",
      capacity,
      status,
    };

    const { data, error } = await supabase
      .from("driver_opportunities")
      .insert(row)
      .select(OPPORTUNITY_SELECT)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, item: data });
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
    await assertStaffPermission("users.drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("driver_opportunities")
      .select(OPPORTUNITY_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) {
      return json({ ok: false, error: "Opportunity not found" }, 404);
    }

    const update: Record<string, unknown> = {};

    if (body.category !== undefined) {
      const category = parseCategory(body.category);
      if (!category) return json({ ok: false, error: "Invalid category" }, 400);
      update.category = category;
    }

    if (body.title !== undefined) {
      const title = String(body.title ?? "").trim();
      if (!title) return json({ ok: false, error: "Title is required" }, 400);
      update.title = title;
    }

    if (body.subtitle !== undefined) {
      update.subtitle =
        typeof body.subtitle === "string" && body.subtitle.trim()
          ? body.subtitle.trim()
          : null;
    }

    if (body.status !== undefined) {
      const status = parseStatus(body.status);
      if (!status) return json({ ok: false, error: "Invalid status" }, 400);
      update.status = status;
    }

    if (body.starts_at !== undefined) {
      const startsAt = parseOptionalIso(body.starts_at);
      if (body.starts_at != null && body.starts_at !== "" && !startsAt) {
        return json({ ok: false, error: "Invalid starts_at" }, 400);
      }
      update.starts_at = startsAt;
    }

    if (body.ends_at !== undefined) {
      const endsAt = parseOptionalIso(body.ends_at);
      if (body.ends_at != null && body.ends_at !== "" && !endsAt) {
        return json({ ok: false, error: "Invalid ends_at" }, 400);
      }
      update.ends_at = endsAt;
    }

    if (body.lat !== undefined || body.lng !== undefined) {
      const lat =
        body.lat !== undefined
          ? parseOptionalNumber(body.lat)
          : (existing.lat as number | null);
      const lng =
        body.lng !== undefined
          ? parseOptionalNumber(body.lng)
          : (existing.lng as number | null);
      if ((lat == null) !== (lng == null)) {
        return json(
          { ok: false, error: "lat and lng must both be set or both omitted" },
          400
        );
      }
      if (lat != null && (lat < -90 || lat > 90)) {
        return json({ ok: false, error: "Invalid lat" }, 400);
      }
      if (lng != null && (lng < -180 || lng > 180)) {
        return json({ ok: false, error: "Invalid lng" }, 400);
      }
      update.lat = lat;
      update.lng = lng;
    }

    if (body.bonus_cents !== undefined) {
      const bonusCents = Math.round(Number(body.bonus_cents));
      if (!Number.isFinite(bonusCents) || bonusCents < 0) {
        return json({ ok: false, error: "Invalid bonus_cents" }, 400);
      }
      update.bonus_cents = bonusCents;
    }

    if (body.currency !== undefined) {
      update.currency =
        typeof body.currency === "string" && body.currency.trim()
          ? body.currency.trim().toUpperCase()
          : "USD";
    }

    if (body.capacity !== undefined) {
      const capacity = parseOptionalInt(body.capacity);
      if (capacity != null && capacity <= 0) {
        return json({ ok: false, error: "Capacity must be positive" }, 400);
      }
      update.capacity = capacity;
    }

    if (!Object.keys(update).length) {
      return json({ ok: false, error: "No fields to update" }, 400);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("driver_opportunities")
      .update(update)
      .eq("id", id)
      .select(OPPORTUNITY_SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
