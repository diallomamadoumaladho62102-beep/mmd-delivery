// apps/web/src/app/api/driver/tax/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ Marker pour confirmer que Next sert bien CE fichier
const ROUTE_VERSION = "tax-download-verify-001";

// Limits / defaults
const DEFAULT_BUCKET = "driver-docs";
const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60; // avoid instant-expire
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function normalizeBucket(input: unknown) {
  const b = String(input ?? "").trim();
  if (!b) return DEFAULT_BUCKET;
  if (b === "driiver-docs") return DEFAULT_BUCKET; // typo guard
  return b;
}

function parseBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  // Keep token untouched; only check prefix case-insensitively
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() || null;
  return token || null;
}

function safeYearFromRequest(req: NextRequest) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");

  // default: previous year (UTC)
  const fallback = new Date().getUTCFullYear() - 1;
  const year = yearParam ? Number(yearParam) : fallback;

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return { ok: false as const, error: "Invalid year" };
  }
  // Ensure integer year
  const y = Math.trunc(year);
  if (String(y) !== String(year)) {
    // If someone passes 2025.5 => reject
    return { ok: false as const, error: "Invalid year" };
  }
  return { ok: true as const, year: y };
}

function safeSignedUrlTTLSeconds() {
  const raw = process.env.TAX_PDF_SIGNED_URL_EXPIRES_SECONDS;
  const n = Number(raw ?? DEFAULT_TTL_SECONDS);

  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS;
  const ttl = Math.trunc(n);

  if (ttl < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return ttl;
}

export async function GET(req: NextRequest) {
  try {
    // Prefer server env if present, otherwise fallback to NEXT_PUBLIC_ for compatibility
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Env (bucket + TTL)
    const envBucketRaw = process.env.TAX_PDF_BUCKET || DEFAULT_BUCKET;
    const signedUrlExpiresSeconds = safeSignedUrlTTLSeconds();

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        {
          routeVersion: ROUTE_VERSION,
          error:
            "Missing env (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
        },
        { status: 500 }
      );
    }

    // ✅ Auth: "Authorization: Bearer <access_token>"
    const token = parseBearerToken(req);

    if (!token) {
      return NextResponse.json(
        {
          routeVersion: ROUTE_VERSION,
          error: "Missing Authorization Bearer token",
        },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(
      token
    );

    if (userErr || !userRes?.user?.id) {
      return NextResponse.json(
        { routeVersion: ROUTE_VERSION, error: "Invalid token" },
        { status: 401 }
      );
    }

    const driverId = userRes.user.id;

    // ✅ Security: only drivers
    const roleResp = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", driverId)
      .single();

    if (roleResp.error) {
      return NextResponse.json(
        {
          routeVersion: ROUTE_VERSION,
          error: "Unable to verify role",
          details: roleResp.error.message,
        },
        { status: 500 }
      );
    }

    const role = (roleResp.data?.role ?? null) as string | null;

    if (role !== "driver") {
      return NextResponse.json(
        {
          routeVersion: ROUTE_VERSION,
          error: "Forbidden: driver role required",
        },
        { status: 403 }
      );
    }

    const yr = safeYearFromRequest(req);
    if (!yr.ok) {
      return NextResponse.json(
        { routeVersion: ROUTE_VERSION, error: yr.error },
        { status: 400 }
      );
    }
    const year = yr.year;

    // ✅ Default storage location (stable)
    let storageBucket = normalizeBucket(envBucketRaw);
    let storagePath = `driver-tax/${driverId}/${year}/tax-summary-${year}.pdf`;

    type TaxDocRow = {
      storage_bucket: string | null;
      storage_path: string | null;
      download_count: number | null;
    };

    let taxDoc: TaxDocRow | null = null;

    // ✅ 1) Try to read metadata from tax_documents (if exists)
    // Soft-fail on missing table / other issues (do not block download)
    try {
      const docResp = await supabaseAdmin
        .from("tax_documents")
        .select("storage_bucket,storage_path,download_count")
        .eq("driver_id", driverId)
        .eq("year", year)
        .maybeSingle();

      if (!docResp.error && docResp.data) {
        taxDoc = docResp.data as TaxDocRow;

        if (taxDoc.storage_bucket) {
          storageBucket = normalizeBucket(taxDoc.storage_bucket);
        }
        if (taxDoc.storage_path) storagePath = taxDoc.storage_path;
      }
    } catch {
      // soft-fail
    }

    // ✅ bucket réellement utilisé pour signer (important)
    const usedBucket = normalizeBucket(storageBucket);

    // ✅ 2) Create signed URL on demand
    const signedResp = await supabaseAdmin.storage
      .from(usedBucket)
      .createSignedUrl(storagePath, signedUrlExpiresSeconds);

    if (signedResp?.error || !signedResp?.data?.signedUrl) {
      return NextResponse.json(
        {
          routeVersion: ROUTE_VERSION,
          error:
            signedResp?.error?.message ??
            "Signed URL failed (file may not exist yet). Generate the PDF first via /api/driver/tax/summary.",
          hint: "Call /api/driver/tax/summary?year=YYYY to generate the PDF, then call this /download route.",
          bucket: usedBucket,
          path: storagePath,
        },
        { status: 404 }
      );
    }

    // ✅ 3) Track download (increment + last_downloaded_at)
    // Soft-fail: do not block download if tracking fails.
    try {
      const nowIso = new Date().toISOString();

      // Best-effort current count
      let current = 0;
      if (taxDoc && Number.isFinite(taxDoc.download_count ?? 0)) {
        current = Number(taxDoc.download_count ?? 0) || 0;
      } else {
        const again = await supabaseAdmin
          .from("tax_documents")
          .select("download_count")
          .eq("driver_id", driverId)
          .eq("year", year)
          .maybeSingle();

        if (!again.error && again.data) {
          current = Number((again.data as any).download_count ?? 0) || 0;
        }
      }

      const nextCount = current + 1;

      // Try update first
      const upd = await supabaseAdmin
        .from("tax_documents")
        .update({
          download_count: nextCount,
          last_downloaded_at: nowIso,
          storage_bucket: usedBucket,
          storage_path: storagePath,
        })
        .eq("driver_id", driverId)
        .eq("year", year)
        .select("driver_id");

      const updatedRows = Array.isArray((upd as any)?.data)
        ? (upd as any).data.length
        : 0;

      // If update failed OR row missing => upsert
      if (upd.error || updatedRows === 0) {
        await supabaseAdmin.from("tax_documents").upsert(
          [
            {
              driver_id: driverId,
              year,
              storage_bucket: usedBucket,
              storage_path: storagePath,
              download_count: 1,
              last_downloaded_at: nowIso,
            },
          ],
          { onConflict: "driver_id,year" }
        );
      }
    } catch {
      // soft-fail
    }

    return NextResponse.json(
      {
        routeVersion: ROUTE_VERSION,
        year,
        driverId,
        file: {
          bucket: usedBucket,
          path: storagePath,
          signedUrl: signedResp.data.signedUrl,
          expiresInSeconds: signedUrlExpiresSeconds,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { routeVersion: ROUTE_VERSION, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}