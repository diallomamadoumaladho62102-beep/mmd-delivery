export type DriverOpportunityRow = {
  id: string;
  category: string;
  title: string;
  subtitle: string | null;
  starts_at: string | null;
  ends_at: string | null;
  lat: number | null;
  lng: number | null;
  bonus_cents: number;
  currency: string;
  capacity: number | null;
  status: string;
};

export type DriverOpportunityFeedItem = DriverOpportunityRow & {
  is_saved: boolean;
  is_joined: boolean;
  signup_count: number;
  distance_miles: number | null;
};

function parseDayWindow(day: string): { start: string; end: string } | null {
  const trimmed = day.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const start = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function loadDriverOpportunitiesFeed(
  supabaseAdmin: {
    from: (table: string) => any;
  },
  params: {
    driverUserId: string;
    day?: string | null;
    category?: string | null;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<DriverOpportunityFeedItem[]> {
  const category = params.category?.trim().toLowerCase() ?? "";
  const dayWindow = params.day ? parseDayWindow(params.day) : null;

  let opportunityIds: string[] | null = null;
  if (category === "saved") {
    const { data: savedRows, error: savedError } = await supabaseAdmin
      .from("driver_saved_opportunities")
      .select("opportunity_id")
      .eq("driver_id", params.driverUserId);

    if (savedError) throw savedError;
    opportunityIds = (savedRows ?? []).map((row: { opportunity_id: string }) => row.opportunity_id);
    if (!opportunityIds.length) return [];
  }

  let query = supabaseAdmin
    .from("driver_opportunities")
    .select(
      "id, category, title, subtitle, starts_at, ends_at, lat, lng, bonus_cents, currency, capacity, status",
    )
    .eq("status", "published");

  if (category && category !== "saved") {
    query = query.eq("category", category);
  }

  if (opportunityIds) {
    query = query.in("id", opportunityIds);
  }

  if (dayWindow && category !== "saved") {
    query = query.or(
      `starts_at.is.null,and(starts_at.gte."${dayWindow.start}",starts_at.lt."${dayWindow.end}")`,
    );
  }

  query = query.order("starts_at", { ascending: true, nullsFirst: false });

  const { data: opportunities, error: oppError } = await query;
  if (oppError) throw oppError;

  const rows = (opportunities ?? []) as DriverOpportunityRow[];
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);

  const [{ data: savedRows }, { data: joinedRows }, { data: signupRows }] = await Promise.all([
    supabaseAdmin
      .from("driver_saved_opportunities")
      .select("opportunity_id")
      .eq("driver_id", params.driverUserId)
      .in("opportunity_id", ids),
    supabaseAdmin
      .from("driver_opportunity_signups")
      .select("opportunity_id")
      .eq("driver_id", params.driverUserId)
      .in("opportunity_id", ids),
    supabaseAdmin.from("driver_opportunity_signups").select("opportunity_id").in("opportunity_id", ids),
  ]);

  const savedSet = new Set(
    (savedRows ?? []).map((row: { opportunity_id: string }) => row.opportunity_id),
  );
  const joinedSet = new Set(
    (joinedRows ?? []).map((row: { opportunity_id: string }) => row.opportunity_id),
  );
  const signupCounts = new Map<string, number>();
  for (const row of signupRows ?? []) {
    const id = String((row as { opportunity_id: string }).opportunity_id);
    signupCounts.set(id, (signupCounts.get(id) ?? 0) + 1);
  }

  const hasCoords =
    params.lat != null &&
    params.lng != null &&
    Number.isFinite(params.lat) &&
    Number.isFinite(params.lng);

  return rows.map((row) => {
    let distanceMiles: number | null = null;
    if (hasCoords && row.lat != null && row.lng != null) {
      distanceMiles = haversineMiles(params.lat!, params.lng!, row.lat, row.lng);
    }

    return {
      ...row,
      is_saved: savedSet.has(row.id),
      is_joined: joinedSet.has(row.id),
      signup_count: signupCounts.get(row.id) ?? 0,
      distance_miles: distanceMiles,
    };
  });
}
