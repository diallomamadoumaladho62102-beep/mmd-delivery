// apps/web/app/api/dispatch/smart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_COOLDOWN_SECONDS = 60;
const MAX_DISPATCH_MILES = 5;

const DISPATCH_WAVES: Record<number, { maxDrivers: number; maxMiles: number }> = {
  1: { maxDrivers: 3, maxMiles: MAX_DISPATCH_MILES },
  2: { maxDrivers: 6, maxMiles: MAX_DISPATCH_MILES },
  3: { maxDrivers: 10, maxMiles: MAX_DISPATCH_MILES },
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function sendExpoPush(messages: any[]) {
  if (messages.length === 0) return { ok: true, tickets: [] };

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const out = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(out?.errors?.[0]?.message || `Expo push failed ${res.status}`);
  }

  return out;
}

async function recordDispatchAttempt(params: {
  supabase: any;
  orderId: string;
  wave: number;
  maxDrivers: number;
  maxMiles: number;
  notifiedCount: number;
  status: string;
}) {
  const { supabase, orderId, wave, maxDrivers, maxMiles, notifiedCount, status } = params;

  const { error } = await supabase.from("order_dispatch_attempts").insert({
    order_id: orderId,
    wave,
    max_drivers: maxDrivers,
    max_miles: maxMiles,
    notified_count: notifiedCount,
    status,
  });

  if (error) {
    console.log("order_dispatch_attempts insert error:", error.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();

    const requestedWave = Math.min(Math.max(Number(body.wave ?? 1), 1), 3);
    const waveConfig = DISPATCH_WAVES[requestedWave] ?? DISPATCH_WAVES[1];

    const maxDrivers = waveConfig.maxDrivers;
    const maxMiles = waveConfig.maxMiles;

    const locationFreshMinutes = Math.min(Number(body.locationFreshMinutes ?? 20), 120);
    const cooldownSeconds = Math.min(
      Math.max(Number(body.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS), 10),
      600
    );

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,kind,status,pickup_lat,pickup_lng,pickup_address,dropoff_address,delivery_fee,driver_delivery_payout,total"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) return json({ error: orderError.message }, 500);
    if (!order) return json({ error: "Order not found" }, 404);

    const pickupLat = toNumber(order.pickup_lat);
    const pickupLng = toNumber(order.pickup_lng);

    if (pickupLat == null || pickupLng == null) {
      await recordDispatchAttempt({
        supabase,
        orderId: order.id,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notifiedCount: 0,
        status: "missing_pickup_coordinates",
      });

      return json({ error: "Order missing pickup coordinates" }, 400);
    }

    const status = String(order.status ?? "").toLowerCase();
    const kind = String(order.kind ?? "").toLowerCase();

    const isDispatchable =
      (kind === "food" && status === "ready") ||
      (kind === "pickup_dropoff" && status === "pending");

    if (!isDispatchable) {
      await recordDispatchAttempt({
        supabase,
        orderId: order.id,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notifiedCount: 0,
        status: "not_dispatchable",
      });

      return json({ error: "Order is not dispatchable", status, kind }, 400);
    }

    const freshSince = new Date(Date.now() - locationFreshMinutes * 60 * 1000).toISOString();

    const { data: locations, error: locError } = await supabase
      .from("driver_locations")
      .select("driver_id,lat,lng,updated_at")
      .gte("updated_at", freshSince);

    if (locError) return json({ error: locError.message }, 500);

    const driverIds = Array.from(
      new Set((locations ?? []).map((r: any) => String(r.driver_id)).filter(Boolean))
    );

    if (driverIds.length === 0) {
      await recordDispatchAttempt({
        supabase,
        orderId: order.id,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notifiedCount: 0,
        status: "no_fresh_locations",
      });

      return json({
        ok: true,
        orderId,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notified: 0,
        candidates: 0,
        skippedCooldown: 0,
        message: "No fresh driver locations found",
      });
    }

    const cooldownSince = new Date(Date.now() - cooldownSeconds * 1000).toISOString();

    const { data: recentDispatches, error: recentError } = await supabase
      .from("driver_dispatch_notifications")
      .select("driver_id,sent_at")
      .in("driver_id", driverIds)
      .gte("sent_at", cooldownSince);

    if (recentError) return json({ error: recentError.message }, 500);

    const recentlyNotifiedDriverIds = new Set(
      (recentDispatches ?? []).map((r: any) => String(r.driver_id))
    );

    const { data: profiles, error: profilesError } = await supabase
      .from("driver_profiles")
      .select(
        "user_id,is_online,status,rating,rating_count,driver_score,driver_tier,cancellation_rate,last_assigned_at"
      )
      .in("user_id", driverIds)
      .eq("is_online", true);

    if (profilesError) return json({ error: profilesError.message }, 500);

    const profileByUserId = new Map<string, any>();
    for (const p of profiles ?? []) {
      profileByUserId.set(String((p as any).user_id), p);
    }

    const allCandidates = (locations ?? [])
      .map((loc: any) => {
        const driverId = String(loc.driver_id);
        const profile = profileByUserId.get(driverId);
        if (!profile) return null;

        const lat = toNumber(loc.lat);
        const lng = toNumber(loc.lng);
        if (lat == null || lng == null) return null;

        const miles = milesBetween(pickupLat, pickupLng, lat, lng);
        if (miles > maxMiles) return null;

        const rating = toNumber(profile.rating) ?? 0;
        const driverScore = toNumber(profile.driver_score) ?? 0;
        const tier = toNumber(profile.driver_tier) ?? 0;
        const cancellationRate = toNumber(profile.cancellation_rate) ?? 0;

        const priorityScore =
          miles * 10 -
          rating * 2 -
          driverScore * 0.03 -
          tier * 1.5 +
          cancellationRate * 10;

        return {
          driverId,
          distanceMiles: Math.round(miles * 100) / 100,
          rating,
          driverScore,
          tier,
          cancellationRate,
          priorityScore: Math.round(priorityScore * 100) / 100,
          skippedByCooldown: recentlyNotifiedDriverIds.has(driverId),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.priorityScore - b.priorityScore);

    const candidates = allCandidates
      .filter((c: any) => !c.skippedByCooldown)
      .slice(0, maxDrivers);

    if (candidates.length === 0) {
      await recordDispatchAttempt({
        supabase,
        orderId: order.id,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notifiedCount: 0,
        status: "no_candidates_outside_cooldown",
      });

      return json({
        ok: true,
        orderId,
        wave: requestedWave,
        maxDrivers,
        maxMiles,
        notified: 0,
        candidates: 0,
        skippedCooldown: allCandidates.filter((c: any) => c.skippedByCooldown).length,
        cooldownSeconds,
        message: "No nearby online drivers available outside cooldown",
      });
    }

    const selectedDriverIds = candidates.map((c: any) => c.driverId);

    const { data: tokens, error: tokensError } = await supabase
      .from("user_push_tokens")
      .select("user_id,expo_push_token,role")
      .in("user_id", selectedDriverIds)
      .eq("role", "driver");

    if (tokensError) return json({ error: tokensError.message }, 500);

    const uniqueTokens = Array.from(
      new Map(
        (tokens ?? [])
          .filter((t: any) => String(t.expo_push_token ?? "").startsWith("ExponentPushToken["))
          .map((t: any) => [String(t.expo_push_token), t])
      ).values()
    );

    const payout =
      toNumber(order.driver_delivery_payout) ??
      toNumber(order.delivery_fee) ??
      toNumber(order.total);

    const messages = uniqueTokens.map((tokenRow: any) => ({
      to: tokenRow.expo_push_token,
      sound: "default",
      title: "Nouvelle course disponible 🚗",
      body: payout
        ? `Course proche • Gain estimé ${payout.toFixed(2)} USD`
        : "Une course proche est disponible.",
      data: {
        type: "smart_dispatch",
        orderId: order.id,
        wave: requestedWave,
        screen: "DriverHome",
      },
      priority: "high",
    }));

    const pushResult = await sendExpoPush(messages);

    const notifiedDriverIds = Array.from(
      new Set(uniqueTokens.map((t: any) => String(t.user_id)).filter(Boolean))
    );

    if (notifiedDriverIds.length > 0) {
      const now = new Date().toISOString();

      const { error: insertError } = await supabase
        .from("driver_dispatch_notifications")
        .insert(
          notifiedDriverIds.map((driverId) => ({
            order_id: order.id,
            driver_id: driverId,
            sent_at: now,
          }))
        );

      if (insertError) {
        console.log("driver_dispatch_notifications insert error:", insertError.message);
      }
    }

    await recordDispatchAttempt({
      supabase,
      orderId: order.id,
      wave: requestedWave,
      maxDrivers,
      maxMiles,
      notifiedCount: messages.length,
      status: messages.length > 0 ? "sent" : "no_tokens",
    });

    return json({
      ok: true,
      orderId,
      wave: requestedWave,
      maxDrivers,
      maxMiles,
      candidates: candidates.length,
      notified: messages.length,
      skippedCooldown: allCandidates.filter((c: any) => c.skippedByCooldown).length,
      cooldownSeconds,
      selectedDrivers: candidates,
      pushResult,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}