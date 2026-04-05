import { NextResponse } from "next/server";

export async function GET() {
  try {
    // TODO:
    // 1. vérifier le restaurant connecté via Supabase auth
    // 2. récupérer ses orders
    // 3. calculer grossSales, platformCommission, netRevenue, totalOrders
    // 4. récupérer les infos de payouts et statements si dispo

    const grossSales = 2132.0;
    const platformCommission = 319.8;
    const netRevenue = 1812.2;
    const totalOrders = 16;

    const pendingPayout = 420.0;
    const lastPayoutAmount = 250.0;
    const lastPayoutDate = "2026-03-01";

    return NextResponse.json({
      ok: true,
      data: {
        currency: "USD",
        grossSales,
        platformCommission,
        netRevenue,
        totalOrders,
        pendingPayout,
        lastPayoutAmount,
        lastPayoutDate,
        profileComplete: false,
        missingFields: ["tax_id"],
        chart: [
          { label: "Mon", gross: 220, net: 187 },
          { label: "Tue", gross: 310, net: 263.5 },
          { label: "Wed", gross: 280, net: 238 },
          { label: "Thu", gross: 190, net: 161.5 },
          { label: "Fri", gross: 420, net: 357 },
          { label: "Sat", gross: 390, net: 331.5 },
          { label: "Sun", gross: 322, net: 273.7 },
        ],
        recentStatements: [
          {
            id: "stmt_2026_02",
            label: "February 2026",
            status: "available",
            type: "monthly",
          },
        ],
        recentPayouts: [
          {
            id: "po_1",
            amount: 250,
            status: "paid",
            date: "2026-03-01",
          },
        ],
      },
    });
  } catch (error) {
    console.error("restaurant financial overview error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to load restaurant financial overview" },
      { status: 500 }
    );
  }
}
