import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  TAXI_CATEGORIES,
  TAXI_CATEGORY_LABELS,
} from "@/lib/driverServicePreferencesTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const countryCode = req.nextUrl.searchParams.get("country_code");
  const city = req.nextUrl.searchParams.get("city");

  const categories = await Promise.all(
    TAXI_CATEGORIES.map(async (category) => {
      const { data: count, error } = await supabaseAdmin.rpc(
        "count_taxi_eligible_drivers_by_category",
        { p_vehicle_class: category },
      );

      const availableCount = error ? 0 : Number(count ?? 0);

      return {
        category,
        label: TAXI_CATEGORY_LABELS[category],
        available: availableCount > 0,
        available_drivers: availableCount,
        unavailable_message: availableCount
          ? null
          : "Aucun chauffeur disponible pour cette catégorie actuellement.",
      };
    }),
  );

  return json({
    ok: true,
    country_code: countryCode,
    city,
    categories,
  });
}
