import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { scoreClientProfileCompleteness } from "@/lib/clientProfileCompleteness";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type SortKey =
  | "created_at"
  | "full_name"
  | "orders_count"
  | "completeness"
  | "last_seen_at";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.clients.read", request);
    const supabase = buildSupabaseAdminClient();
    const sp = request.nextUrl.searchParams;

    const q = String(sp.get("q") ?? "").trim().toLowerCase();
    const page = Math.max(Number(sp.get("page") ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(sp.get("pageSize") ?? 25), 1), 100);
    const sort = (String(sp.get("sort") ?? "created_at") as SortKey) || "created_at";
    const orderAsc = String(sp.get("order") ?? "desc").toLowerCase() === "asc";

    // Default: real + active (exclude deleted). Dedicated filters override.
    const kindFilter = String(sp.get("kind") ?? "real").trim().toLowerCase();
    const statusFilter = String(sp.get("status") ?? "active").trim().toLowerCase();
    const incompleteOnly = sp.get("incomplete") === "1" || sp.get("incomplete") === "true";
    const includeDeleted = kindFilter === "deleted" || statusFilter === "deleted";

    let query = supabase
      .from("profiles")
      .select(
        "id, role, full_name, email, phone, account_status, account_kind, phone_verified_at, phone_e164, avatar_url, personal_photo_url, created_at, last_seen_at, staff_country_code",
        { count: "exact" },
      )
      .eq("role", "client");

    if (kindFilter && kindFilter !== "all") {
      if (kindFilter === "deleted") {
        query = query.eq("account_status", "deleted");
      } else {
        query = query.eq("account_kind", kindFilter);
      }
    }

    if (!includeDeleted && statusFilter !== "all" && kindFilter !== "deleted") {
      if (statusFilter === "suspended") query = query.eq("account_status", "suspended");
      else if (statusFilter === "disabled") query = query.eq("account_status", "disabled");
      else if (statusFilter === "active") query = query.eq("account_status", "active");
      else query = query.neq("account_status", "deleted");
    } else if (!includeDeleted && kindFilter !== "deleted") {
      query = query.neq("account_status", "deleted");
    }

    if (q) {
      query = query.or(
        `full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,id.eq.${q}`,
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (sort === "full_name" || sort === "created_at" || sort === "last_seen_at") {
      query = query.order(sort, { ascending: orderAsc, nullsFirst: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);
    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) => ({ ...row }));
    const ids = items.map((r) => String(r.id));

    const missingIds = items.filter((row) => !row.email).map((row) => row.id);
    if (missingIds.length > 0) {
      const { data: emailRows } = await supabase.rpc("admin_lookup_user_emails", {
        p_ids: missingIds,
      });
      if (Array.isArray(emailRows)) {
        const byId = new Map(
          emailRows.map((row: { id: string; email: string | null }) => [
            String(row.id),
            row.email ?? null,
          ]),
        );
        for (const row of items) {
          if (!row.email) row.email = byId.get(String(row.id)) ?? row.email;
        }
      }
    }

    // client_profiles
    const cpById = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data: cps } = await supabase
        .from("client_profiles")
        .select(
          "user_id, full_name, phone, avatar_url, address, default_address, city, state, country, postal_code",
        )
        .in("user_id", ids);
      for (const row of cps ?? []) {
        cpById.set(String(row.user_id), row as Record<string, unknown>);
      }
    }

    // default addresses with coords if present
    const addrById = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data: addrs } = await supabase
        .from("client_addresses")
        .select(
          "user_id, address_line1, city, country, latitude, longitude, lat, lng, is_default",
        )
        .in("user_id", ids)
        .eq("is_default", true);
      for (const row of addrs ?? []) {
        addrById.set(String(row.user_id), row as Record<string, unknown>);
      }
    }

    // order counts (food orders)
    const orderCountById = new Map<string, number>();
    if (ids.length) {
      const { data: orders } = await supabase
        .from("orders")
        .select("client_id")
        .in("client_id", ids);
      for (const row of orders ?? []) {
        const id = String(row.client_id ?? "");
        if (!id) continue;
        orderCountById.set(id, (orderCountById.get(id) ?? 0) + 1);
      }
    }

    // wallet balances (read-only)
    const walletById = new Map<string, { balance_cents: number; currency: string }>();
    if (ids.length) {
      const { data: wallets } = await supabase
        .from("mmd_credit_wallets")
        .select("user_id, balance_cents, currency")
        .in("user_id", ids);
      for (const row of wallets ?? []) {
        walletById.set(String(row.user_id), {
          balance_cents: Number(row.balance_cents ?? 0),
          currency: String(row.currency ?? "USD"),
        });
      }
    }

    // Auth email confirmation (batch via admin API — limited page size)
    const emailVerifiedById = new Map<string, boolean>();
    for (const id of ids) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(id);
        emailVerifiedById.set(
          id,
          Boolean(authUser.user?.email_confirmed_at),
        );
      } catch {
        emailVerifiedById.set(id, false);
      }
    }

    let enriched = items.map((row) => {
      const id = String(row.id);
      const cp = cpById.get(id) ?? {};
      const addr = addrById.get(id) ?? {};
      const avatar =
        String(row.avatar_url ?? row.personal_photo_url ?? cp.avatar_url ?? "").trim() ||
        null;
      const fullName =
        String(row.full_name ?? cp.full_name ?? "").trim() || null;
      const phone =
        String(row.phone_e164 ?? row.phone ?? cp.phone ?? "").trim() || null;
      const addressLine =
        String(
          addr.address_line1 ?? cp.address ?? cp.default_address ?? "",
        ).trim() || null;
      const city = String(addr.city ?? cp.city ?? "").trim() || null;
      const country =
        String(addr.country ?? cp.country ?? row.staff_country_code ?? "").trim() ||
        null;
      const lat = Number(addr.latitude ?? addr.lat);
      const lng = Number(addr.longitude ?? addr.lng);
      const emailVerified = emailVerifiedById.get(id) === true;
      const phoneVerified = Boolean(row.phone_verified_at);
      const completeness = scoreClientProfileCompleteness({
        fullName,
        email: row.email,
        emailVerified,
        phone,
        phoneVerified,
        avatarUrl: avatar,
        addressLine,
        city,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      });

      return {
        id,
        full_name: fullName,
        email: row.email ?? null,
        phone,
        avatar_url: avatar,
        account_status: row.account_status,
        account_kind: row.account_kind ?? "real",
        country,
        city,
        created_at: row.created_at,
        last_seen_at: row.last_seen_at ?? null,
        orders_count: orderCountById.get(id) ?? 0,
        wallet_balance_cents: walletById.get(id)?.balance_cents ?? 0,
        wallet_currency: walletById.get(id)?.currency ?? "USD",
        email_verified: emailVerified,
        phone_verified: phoneVerified,
        address_verified: completeness.checks.address_verified,
        completeness_percent: completeness.percent,
        completeness_status: completeness.status,
        missing_fields: completeness.missing,
      };
    });

    if (incompleteOnly) {
      enriched = enriched.filter((r) => r.completeness_status === "incomplete");
    }

    if (sort === "orders_count" || sort === "completeness") {
      enriched.sort((a, b) => {
        const av =
          sort === "orders_count" ? a.orders_count : a.completeness_percent;
        const bv =
          sort === "orders_count" ? b.orders_count : b.completeness_percent;
        return orderAsc ? av - bv : bv - av;
      });
    }

    return json({
      ok: true,
      items: enriched,
      page,
      pageSize,
      total: count ?? enriched.length,
      filters: {
        kind: kindFilter,
        status: statusFilter,
        incomplete: incompleteOnly,
        q,
        sort,
        order: orderAsc ? "asc" : "desc",
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status,
    );
  }
}
