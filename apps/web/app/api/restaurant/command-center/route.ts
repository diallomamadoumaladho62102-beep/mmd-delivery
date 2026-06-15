import { NextRequest, NextResponse } from "next/server";
import { getRestaurantCommandCenter } from "@/lib/restaurantCommandCenter";
import { requireRestaurantApiUser } from "@/lib/restaurantCommandCenterAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRestaurantApiUser(req);
    if (auth.ok === false) {
      return jsonError(auth.message, auth.status);
    }

    const data = await getRestaurantCommandCenter({
      supabase: auth.ctx.admin,
      restaurantUserId: auth.ctx.restaurantUserId,
    });

    return NextResponse.json(
      { ok: true, data },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error) {
    console.error("restaurant command-center error:", error);
    return jsonError("Failed to load restaurant command center", 500);
  }
}
