import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiAddressConfig } from "@/lib/taxiAddressConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const countryCode = normalizeTaxiCountryCode(
      req.nextUrl.searchParams.get("country_code") ??
        req.nextUrl.searchParams.get("countryCode") ??
        "US",
    );

    const { data: countryRow } = await auth.supabaseAdmin
      .from("taxi_countries")
      .select("metadata")
      .eq("country_code", countryCode)
      .maybeSingle();

    const addressConfig = resolveTaxiAddressConfig(
      countryCode,
      countryRow?.metadata,
    );

    return taxiJson({
      ok: true,
      address_config: addressConfig,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
