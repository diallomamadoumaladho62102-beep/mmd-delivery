import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessAuditLogs,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReviewBody = {
  orderId?: unknown;
  anomalyKind?: unknown;
  isReviewed?: unknown;
  isResolved?: unknown;
  adminNote?: unknown;
};

type ReviewStatus = "open" | "reviewed" | "resolved";

type ReviewUpsertPayload = {
  order_id: string;
  anomaly_kind: string;
  status: ReviewStatus;
  is_reviewed: boolean;
  is_resolved: boolean;
  admin_note: string | null;
  actor: string;
  metadata: Record<string, never>;
  updated_at: string;
};

function normalizeReviewStatus(params: {
  isReviewed: boolean;
  isResolved: boolean;
}): ReviewStatus {
  const { isReviewed, isResolved } = params;

  if (isResolved) {
    return "resolved";
  }

  if (isReviewed) {
    return "reviewed";
  }

  return "open";
}

async function parseBody(request: NextRequest): Promise<ReviewBody> {
  try {
    const body = (await request.json()) as ReviewBody | null;

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

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function buildPayload(params: {
  orderId: string;
  anomalyKind: string;
  isReviewed: boolean;
  isResolved: boolean;
  adminNote: string;
  actor: string;
  updatedAt: string;
}): ReviewUpsertPayload {
  const {
    orderId,
    anomalyKind,
    isReviewed,
    isResolved,
    adminNote,
    actor,
    updatedAt,
  } = params;

  return {
    order_id: orderId,
    anomaly_kind: anomalyKind,
    status: normalizeReviewStatus({ isReviewed, isResolved }),
    is_reviewed: isReviewed,
    is_resolved: isResolved,
    admin_note: adminNote.length > 0 ? adminNote : null,
    actor,
    metadata: {},
    updated_at: updatedAt,
  };
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

    const orderId = normalizeString(body.orderId);
    const anomalyKind = normalizeString(body.anomalyKind);
    const adminNote = normalizeString(body.adminNote);
    const requestedReviewed = normalizeBoolean(body.isReviewed);
    const requestedResolved = normalizeBoolean(body.isResolved);

    if (!orderId) {
      return badRequest("orderId is required.");
    }

    if (!anomalyKind) {
      return badRequest("anomalyKind is required.");
    }

    const isResolved = requestedResolved;
    const isReviewed = requestedReviewed || isResolved;

    const supabase = buildSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const payload = buildPayload({
      orderId,
      anomalyKind,
      isReviewed,
      isResolved,
      adminNote,
      actor,
      updatedAt: nowIso,
    });

    const { data, error } = await supabase
      .from("admin_payout_case_reviews")
      .upsert(payload, {
        onConflict: "order_id,anomaly_kind",
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save case review: ${error.message}`);
    }

    if (!data) {
      throw new Error("Case review was not returned after save.");
    }

    await writeGlobalAdminAuditLog({
      supabase,
      adminUserId: actor,
      action: isResolved ? "payout_resolved" : "payout_reviewed",
      targetType: "payout",
      targetId: orderId,
      metadata: {
        order_id: orderId,
        anomaly_kind: anomalyKind,
        review_status: payload.status,
        is_reviewed: isReviewed,
        is_resolved: isResolved,
        admin_note: payload.admin_note,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        item: data,
        message: "Case review saved.",
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown review save error";

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