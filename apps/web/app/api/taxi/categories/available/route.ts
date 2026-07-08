import { NextRequest } from "next/server";
import {
  TAXI_CATEGORIES,
  TAXI_CATEGORY_LABELS,
} from "@/lib/driverServicePreferencesTypes";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTaxiApiUser(req);
  if (auth.ok === false) return auth.response;

  const countryCode = req.nextUrl.searchParams.get("country_code");
  const city = req.nextUrl.searchParams.get("city");

  const categories = await Promise.all(
    TAXI_CATEGORIES.map(async (category) => {
      const { data: count, error } = await auth.supabaseUser.rpc(
        "count_taxi_eligible_drivers_by_category",
        { p_vehicle_class: category },
      );

      const availableCount = error ? 0 : Number(count ?? 0);

      return {
        category,
        label: TAXI_CATEGORY_LABELS[category],
        available: availableCount > 0,
        unavailable_message: availableCount
          ? null
          : "Aucun chauffeur disponible pour cette catégorie actuellement.",
      };
    }),
  );

  return taxiJson({
    ok: true,
    country_code: countryCode,
    city,
    categories,
  });
}
