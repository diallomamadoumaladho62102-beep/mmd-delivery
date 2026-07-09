import { NextRequest, NextResponse } from "next/server";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";
import {
  readWebSentryDsnConfigured,
  sendWebSentryProbe,
} from "@/lib/sentryProbe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/monitoring/sentry-probe
 * Auth: MONITORING_SECRET or CRON_SECRET (same as /api/monitoring).
 * Sends a real tagged exception to the configured web Sentry project.
 */
export async function POST(request: NextRequest) {
  if (!isInternalHealthAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dsn = readWebSentryDsnConfigured();
  const result = await sendWebSentryProbe({
    route: "/api/monitoring/sentry-probe",
    vercel_env: process.env.VERCEL_ENV ?? null,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      target: "web",
      project_hint: "mmd-delivery-web",
      dsn_configured: dsn.configured,
      dsn_sources: dsn.sources,
      event_id: result.eventId,
      message: result.message,
      error: result.error ?? null,
      instructions:
        "Open Sentry → mmd-delivery-web → Issues and search for tag mmd_sentry_probe or message prefix 'MMD Sentry web probe'.",
    },
    { status: result.ok ? 200 : 503 }
  );
}

export async function GET(request: NextRequest) {
  if (!isInternalHealthAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dsn = readWebSentryDsnConfigured();
  return NextResponse.json({
    ok: true,
    target: "web",
    dsn_configured: dsn.configured,
    dsn_sources: dsn.sources,
    probe: "POST this route with Authorization: Bearer <MONITORING_SECRET|CRON_SECRET>",
  });
}
