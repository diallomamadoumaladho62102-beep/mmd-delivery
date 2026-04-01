import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessAuditLogs,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuditStatus = "requested" | "rejected" | "succeeded" | "failed";
type AuditTarget = "restaurant" | "driver";
type SortDirection = "asc" | "desc";

type AuditRow = {
  id: string;
  order_id: string;
  target: AuditTarget | string;
  action: string;
  actor: string | null;
  status: AuditStatus | string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type AuditFilters = {
  q: string;
  status: AuditStatus | "all";
  target: AuditTarget | "all";
  sort: SortDirection;
  limit: number;
};

function normalizeStatus(value: string | null): AuditStatus | "all" {
  if (
    value === "requested" ||
    value === "rejected" ||
    value === "succeeded" ||
    value === "failed"
  ) {
    return value;
  }

  return "all";
}

function normalizeTarget(value: string | null): AuditTarget | "all" {
  if (value === "restaurant" || value === "driver") {
    return value;
  }

  return "all";
}

function normalizeSort(value: string | null): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

function normalizeQuery(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.trim().slice(0, 200);
}

function sanitizeForOrIlike(value: string): string {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

function parseFilters(request: NextRequest): AuditFilters {
  const { searchParams } = new URL(request.url);

  return {
    q: normalizeQuery(searchParams.get("q")),
    status: normalizeStatus(searchParams.get("status")),
    target: normalizeTarget(searchParams.get("target")),
    sort: normalizeSort(searchParams.get("sort")),
    limit: normalizeLimit(searchParams.get("limit")),
  };
}

function buildSummary(rows: AuditRow[], totalMatching: number) {
  return {
    total: rows.length,
    total_matching: totalMatching,
    requested: rows.filter((row) => row.status === "requested").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
    succeeded: rows.filter((row) => row.status === "succeeded").length,
    failed: rows.filter((row) => row.status === "failed").length,
    restaurant: rows.filter((row) => row.target === "restaurant").length,
    driver: rows.filter((row) => row.target === "driver").length,
  };
}

function buildSearchClause(q: string): string | null {
  const safeQuery = sanitizeForOrIlike(q);

  if (!safeQuery) {
    return null;
  }

  return [
    `order_id.ilike.%${safeQuery}%`,
    `target.ilike.%${safeQuery}%`,
    `status.ilike.%${safeQuery}%`,
    `actor.ilike.%${safeQuery}%`,
    `action.ilike.%${safeQuery}%`,
    `message.ilike.%${safeQuery}%`,
  ].join(",");
}

export async function GET(request: NextRequest) {
  try {
    await assertCanAccessAuditLogs();

    const supabase = buildSupabaseAdminClient();
    const filters = parseFilters(request);

    let query = supabase
      .from("admin_payout_audit_logs")
      .select(
        `
          id,
          order_id,
          target,
          action,
          actor,
          status,
          message,
          metadata,
          created_at
        `,
        { count: "exact" }
      );

    if (filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters.target !== "all") {
      query = query.eq("target", filters.target);
    }

    const searchClause = buildSearchClause(filters.q);

    if (searchClause) {
      query = query.or(searchClause);
    }

    query = query
      .order("created_at", { ascending: filters.sort === "asc" })
      .limit(filters.limit);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to load audit logs: ${error.message}`);
    }

    const items = (data ?? []) as AuditRow[];
    const summary = buildSummary(items, count ?? items.length);

    return NextResponse.json(
      {
        ok: true,
        items,
        summary,
        filters,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown audit logs error";

    const status = error instanceof AdminAccessError ? error.status : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status }
    );
  }
}