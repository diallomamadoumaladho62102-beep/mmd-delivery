import { NextRequest, NextResponse } from "next/server";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Allowlisted historical issue IDs from the pre-launch Sentry audit.
 * Only these may be bulk-resolved via this endpoint (no open-ended wipe).
 *
 * Kept open intentionally (not listed):
 * - MMD-DELIVERY-MOBILE-4 (EXC_BAD_ACCESS) — native crash not fully attributed
 */
const ALLOWLISTED_ISSUE_IDS = new Set<string>([
  // Web
  "7601658379", // WEB-1 probe
  "7604498912", // WEB-2 marketplace_available null
  "7608768195", // WEB-3 marketplace_available null
  "7635555383", // WEB-4 probe
  "7639558705", // WEB-5 document_status coalesce
  // Mobile
  "7601662273", // MOBILE-1 probe
  "7603180350", // MOBILE-2 ExpoNetwork
  "7603180358", // MOBILE-3 ExpoNetwork cocoa
  "7621016205", // MOBILE-5 audio session
  "7635829154", // MOBILE-6 object capture
  "7637771264", // MOBILE-7 document_status
  "7637771274", // MOBILE-8 object capture
  "7638967273", // MOBILE-9 <unknown>
  "7639558717", // MOBILE-A document_status
  "7644362681", // MOBILE-B HTTP 504 historical
  "7644816837", // MOBILE-C <unknown>
  "7645086429", // MOBILE-D <unknown>
]);

type Body = {
  issueIds?: unknown;
  dryRun?: unknown;
  status?: unknown;
};

export async function POST(request: NextRequest) {
  if (!isInternalHealthAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = String(process.env.SENTRY_AUTH_TOKEN ?? "").trim();
  const org = String(process.env.SENTRY_ORG ?? "mmd-delivery").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "SENTRY_AUTH_TOKEN missing" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const requested = Array.isArray(body?.issueIds)
    ? body!.issueIds.map((id) => String(id).trim()).filter(Boolean)
    : [...ALLOWLISTED_ISSUE_IDS];
  const dryRun = body?.dryRun === true;
  const status =
    body?.status === "resolved" || body?.status === "ignored"
      ? body.status
      : "resolved";

  const rejected = requested.filter((id) => !ALLOWLISTED_ISSUE_IDS.has(id));
  const allowed = requested.filter((id) => ALLOWLISTED_ISSUE_IDS.has(id));

  if (rejected.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "One or more issue IDs are not in the historical allowlist.",
        rejected,
      },
      { status: 400 },
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const id of allowed) {
    if (dryRun) {
      results.push({ id, action: "dry_run", status });
      continue;
    }

    const res = await fetch(`https://sentry.io/api/0/issues/${encodeURIComponent(id)}/`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status,
        statusDetails: {},
      }),
      cache: "no-store",
    });

    const text = await res.text();
    let detail: unknown = null;
    try {
      detail = JSON.parse(text);
    } catch {
      detail = text.slice(0, 200);
    }

    results.push({
      id,
      httpStatus: res.status,
      ok: res.ok,
      shortId:
        detail && typeof detail === "object" && "shortId" in detail
          ? String((detail as { shortId?: string }).shortId ?? "")
          : null,
      status:
        detail && typeof detail === "object" && "status" in detail
          ? String((detail as { status?: string }).status ?? "")
          : null,
    });
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok === true || r.action === "dry_run"),
    org,
    status,
    dryRun,
    resolvedCount: results.filter((r) => r.ok === true).length,
    results,
    note:
      "MOBILE-4 (EXC_BAD_ACCESS / 7603180508) intentionally excluded — native crash not fully attributed.",
  });
}
