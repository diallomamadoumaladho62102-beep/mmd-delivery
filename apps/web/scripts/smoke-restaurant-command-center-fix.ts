import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { getRestaurantCommandCenter } from "../src/lib/restaurantCommandCenter";
import { getRestaurantAiGrowth } from "../src/lib/restaurantAiGrowth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const restaurantUserId =
  process.argv[2] || "b92dfca2-32f4-424a-bc1b-8f3d9666f565";

async function main() {
  const cc = await getRestaurantCommandCenter({
    supabase: sb,
    restaurantUserId,
  });
  const ai = await getRestaurantAiGrowth({
    supabase: sb,
    restaurantUserId,
    commandCenter: cc,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        restaurantUserId,
        currency: cc.restaurant.currency,
        ordersToday: cc.kpis.ordersToday,
        revenueToday: cc.kpis.revenueToday,
        topProducts: cc.topProducts.length,
        aiRecommendations: ai.recommendations.length,
        hasEnoughData: ai.hasEnoughData,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      restaurantUserId,
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
