import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildRestaurantTaxStoragePath,
  getRestaurantTaxSummary,
} from "@/lib/restaurantTax";
import { buildRestaurantTaxPdf } from "@/lib/restaurantPdf";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function getRequestYear(req: NextRequest): number {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = Number(yearParam ?? new Date().getFullYear());

  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error("Invalid year");
  }

  return year;
}

function shouldDownload(req: NextRequest): boolean {
  const url = new URL(req.url);
  const raw = url.searchParams.get("download");
  return raw === "1" || raw === "true";
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Missing bearer token", 401);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonError(
        "Missing Supabase environment variables (URL / ANON / SERVICE ROLE)",
        500
      );
    }

    const year = getRequestYear(req);
    const download = shouldDownload(req);

    // Client auth: vérifie la vraie session utilisateur via bearer token
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return jsonError("Invalid session", 401);
    }

    const restaurantUserId = authData.user.id;

    // Admin client: accès DB + storage
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let signedUrl: string | null = null;

    if (download) {
      const summaryForPdf = await getRestaurantTaxSummary({
        supabase: admin,
        restaurantUserId,
        year,
      });

      const pdfBytes = await buildRestaurantTaxPdf(summaryForPdf);

      const bucket = "restaurant-docs";
      const path = buildRestaurantTaxStoragePath(restaurantUserId, year);

      const { error: uploadError } = await admin.storage
        .from(bucket)
        .upload(path, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        return jsonError(uploadError.message || "Failed to upload PDF", 500);
      }

      const expiresIn = Number(
        process.env.RESTAURANT_TAX_SIGNED_URL_TTL_SECONDS ?? 3600
      );

      const { data: signedData, error: signedError } = await admin.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (signedError) {
        return jsonError(
          signedError.message || "Failed to create signed URL",
          500
        );
      }

      signedUrl = signedData?.signedUrl ?? null;
    }

    const summary = await getRestaurantTaxSummary({
      supabase: admin,
      restaurantUserId,
      year,
      signedUrl,
    });

    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    const message =
      error?.message === "Invalid year"
        ? "Invalid year"
        : error?.message || "Unexpected server error";

    return NextResponse.json(
      { error: message },
      { status: message === "Invalid year" ? 400 : 500 }
    );
  }
}