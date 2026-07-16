import { NextRequest } from "next/server";
import {
  TAXI_CATEGORIES,
  TAXI_CATEGORY_LABELS,
} from "@/lib/driverServicePreferencesTypes";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { cacheWrap } from "@/lib/memoryCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTaxiApiUser(req);
  if (auth.ok === false) return auth.response;

  const countryCode = req.nextUrl.searchParams.get("country_code");
  const city = req.nextUrl.searchParams.get("city");

  const counts = await cacheWrap(
    "taxi:eligible-category-counts:v1",
    15_000,
    async () => {
      const { data, error } = await auth.supabaseUser.rpc(
        "count_taxi_eligible_drivers_all_categories"
      );
      if (error) {
        // Fallback: preserve availability semantics with zeros rather than failing the quote UI.
        console.warn("[taxi/categories] batch count failed:", error.message);
        return {} as Record<string, number>;
      }
      return (data ?? {}) as Record<string, number>;
    }
  );

  const categories = TAXI_CATEGORIES.map((category) => {
    const availableCount = Number(counts[category] ?? 0);
    return {
      category,
      label: TAXI_CATEGORY_LABELS[category],
      available: availableCount > 0,
      unavailable_message: availableCount
        ? null
        : "Aucun chauffeur disponible pour cette catégorie actuellement.",
    };
  });

  return taxiJson({
    ok: true,
    country_code: countryCode,
    city,
    categories,
  });
}
