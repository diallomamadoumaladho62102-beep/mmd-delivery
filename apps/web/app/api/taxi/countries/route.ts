import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const [{ data: countries, error: countriesError }, { data: currencies, error: currenciesError }] =
      await Promise.all([
        auth.supabaseAdmin.rpc("list_taxi_countries"),
        auth.supabaseAdmin.rpc("list_taxi_currencies"),
      ]);

    if (countriesError) {
      return taxiJson({ ok: false, error: countriesError.message }, 500);
    }

    if (currenciesError) {
      return taxiJson({ ok: false, error: currenciesError.message }, 500);
    }

    return taxiJson({
      ok: true,
      countries: countries ?? [],
      currencies: currencies ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
