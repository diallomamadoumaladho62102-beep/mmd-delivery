import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessAuditLogs,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BulkReviewItem = {
  orderId?: unknown;
  anomalyKind?: unknown;
};

type BulkReviewAction = "review" | "resolve" | "reopen";

type BulkReviewBody = {
  items?: unknown;
  action?: unknown;
};

type BulkUpsertRow = {
  order_id: string;
  anomaly_kind: string;
  status: "open" | "reviewed" | "resolved";
  is_reviewed: boolean;
  is_resolved: boolean;
  actor: string;
  updated_at: string;
};

const MAX_BULK_ITEMS = 200;

function isBulkReviewAction(value: unknown): value is BulkReviewAction {
  return value === "review" || value === "resolve" || value === "reopen";
}

async function parseBody(request: NextRequest): Promise<BulkReviewBody> {
  try {
    const body = (await request.json()) as BulkReviewBody | null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Request body must be a valid JSON object.");
    }

    return body;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function deriveFlags(action: BulkReviewAction): {
  status: "open" | "reviewed" | "resolved";
  isReviewed: boolean;
  isResolved: boolean;
} {
  if (action === "resolve") {
    return {
      status: "resolved",
      isReviewed: true,
      isResolved: true,
    };
  }

  if (action === "review") {
    return {
      status: "reviewed",
      isReviewed: true,
      isResolved: false,
    };
  }

  return {
    status: "open",
    isReviewed: false,
    isResolved: false,
  };
}

function normalizeItems(value: unknown): BulkReviewItem[] {
  return Array.isArray(value) ? (value as BulkReviewItem[]) : [];
}

function buildBulkUpsertRows(params: {
  items: BulkReviewItem[];
  action: BulkReviewAction;
  actor: string;
  updatedAt: string;
}): BulkUpsertRow[] {
  const { items, action, actor, updatedAt } = params;
  const flags = deriveFlags(action);
  const rows: BulkUpsertRow[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const orderId = normalizeString(item?.orderId);
    const anomalyKind = normalizeString(item?.anomalyKind);

    if (!orderId || !anomalyKind) {
      throw new Error("Each bulk item must contain orderId and anomalyKind.");
    }

    const dedupeKey = `${orderId}::${anomalyKind}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    rows.push({
      order_id: orderId,
      anomaly_kind: anomalyKind,
      status: flags.status,
      is_reviewed: flags.isReviewed,
      is_resolved: flags.isResolved,
      actor,
      updated_at: updatedAt,
    });
  }

  return rows;
}

async function writeGlobalAdminAuditLog(params: {
  supabase: ReturnType<typeof buildSupabaseAdminClient>;
  adminUserId: string;
  action: "payout_reviewed" | "payout_resolved";
  targetType: "payout" | "order";
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, adminUserId, action, targetType, targetId, metadata } =
    params;

  const { error } = await supabase.from("admin_audit_logs").insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata: metadata ?? {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to write global admin audit log: ${error.message}`);
  }
}

function badRequest(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const admin = await assertCanAccessAuditLogs();
    const actor = admin.userId;

    const body = await parseBody(request);
    const items = normalizeItems(body.items);
    const action = body.action;

    if (!isBulkReviewAction(action)) {
      return badRequest("action must be one of: review, resolve, reopen.");
    }

    if (items.length === 0) {
      return badRequest("items is required and must contain at least one row.");
    }

    if (items.length > MAX_BULK_ITEMS) {
      return badRequest(
        `Too many items. Maximum allowed per request is ${MAX_BULK_ITEMS}.`
      );
    }

    const supabase = buildSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const rows = buildBulkUpsertRows({
      items,
      action,
      actor,
      updatedAt: nowIso,
    });

    if (rows.length === 0) {
      return badRequest("No valid bulk items found after normalization.");
    }

    const { data, error } = await supabase
      .from("admin_payout_case_reviews")
      .upsert(rows, {
        onConflict: "order_id,anomaly_kind",
      })
      .select(
        "order_id, anomaly_kind, status, is_reviewed, is_resolved, updated_at"
      );

    if (error) {
      throw new Error(`Failed to save bulk case reviews: ${error.message}`);
    }

    const savedItems = data ?? [];

    const auditAction =
      action === "resolve" ? "payout_resolved" : "payout_reviewed";

    await Promise.all(
      rows.map((row) =>
        writeGlobalAdminAuditLog({
          supabase,
          adminUserId: actor,
          action: auditAction,
          targetType: "payout",
          targetId: row.order_id,
          metadata: {
            order_id: row.order_id,
            anomaly_kind: row.anomaly_kind,
            bulk_action: action,
            review_status: row.status,
            is_reviewed: row.is_reviewed,
            is_resolved: row.is_resolved,
          },
        })
      )
    );

    return NextResponse.json(
      {
        ok: true,
        count: savedItems.length,
        action,
        items: savedItems,
        message: `Bulk action '${action}' applied successfully.`,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown bulk review error";

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