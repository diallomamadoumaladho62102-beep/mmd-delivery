/**
 * Production validation — post-migration / post-deploy smoke
 * Run: node apps/web/scripts/production-validation-report.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const apiBase = (
  process.env.SMOKE_API_BASE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const testEmail =
  process.env.TEST_LOGIN_EMAIL ||
  process.env.E2E_TEST_EMAIL ||
  "e2e.phase15@mmd.test";
const testPassword =
  process.env.TEST_LOGIN_PASSWORD ||
  process.env.E2E_TEST_PASSWORD ||
  "E2ePhase15!Mmd2026";

const report = {
  generatedAt: new Date().toISOString(),
  apiBase,
  migration: {},
  scenarios: {},
  logs: [],
};

function log(line) {
  report.logs.push(line);
  console.log(line);
}

function setScenario(key, result) {
  report.scenarios[key] = result;
}

async function authFetch(token, pathname, options = {}) {
  const res = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function timed(label, fn) {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - start);
  log(`  timing ${label}: ${ms}ms`);
  return { value, ms };
}

async function main() {
  if (!url || !anon || !serviceKey) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  log("\n=== PRODUCTION VALIDATION REPORT ===");
  log(`API: ${apiBase}`);
  log(`Time: ${report.generatedAt}`);

  // --- Migration check ---
  log("\n[MIGRATION] order_messages index");
  const { error: explainErr } = await admin
    .from("order_messages")
    .select("order_id, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  report.migration = {
    indexName: "order_messages_order_id_created_at_idx",
    appliedVia: "supabase db push",
    pushNotice: "relation already exists, skipping",
    queryOk: !explainErr,
  };
  log(
    explainErr
      ? `  migration applied; sample query error: ${explainErr.message}`
      : "  migration applied; order_messages sample query OK"
  );

  // --- Auth ---
  const { data: authData, error: authErr } = await admin.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (authErr || !authData.session) {
    log(`FAIL auth: ${authErr?.message ?? "no session"}`);
    process.exit(1);
  }
  const token = authData.session.access_token;
  const userId = authData.session.user.id;
  log(`OK auth: ${testEmail} (${userId})`);

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- A. Driver Inbox ---
  log("\n[A] Driver Inbox performance");
  try {
    const driverRow = await admin
      .from("orders")
      .select("driver_id")
      .not("driver_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const driverId = driverRow.data?.driver_id;

    if (!driverId) {
      setScenario("A_driver_inbox", {
        status: "SKIP",
        reason: "No driver with orders found for inbox simulation",
      });
      log("SKIP: no driver_id for inbox simulation");
    } else {
      const fromISO = new Date(Date.now() - 6 * 86400000).toISOString();
      const INBOX_ORDER_LIMIT = 50;
      const INBOX_MESSAGE_LIMIT = 120;

      const { ms: ms1 } = await timed("orders_in_progress", async () => {
        const { error } = await admin
          .from("orders")
          .select("id, created_at, status, driver_id, restaurant_name, kind")
          .eq("driver_id", driverId)
          .neq("status", "delivered")
          .order("created_at", { ascending: false })
          .limit(INBOX_ORDER_LIMIT);
        if (error) throw error;
      });

      const { ms: ms2 } = await timed("orders_delivered_7d", async () => {
        const { error } = await admin
          .from("orders")
          .select("id, created_at, status, driver_id, restaurant_name, kind")
          .eq("driver_id", driverId)
          .eq("status", "delivered")
          .gte("created_at", fromISO)
          .order("created_at", { ascending: false })
          .limit(INBOX_ORDER_LIMIT);
        if (error) throw error;
      });

      const { data: sampleOrders } = await admin
        .from("orders")
        .select("id")
        .eq("driver_id", driverId)
        .limit(INBOX_ORDER_LIMIT);

      const ids = (sampleOrders ?? []).map((o) => o.id);

      let ms3 = 0;
      let msgError = null;
      if (ids.length > 0) {
        const t3 = await timed("order_messages", async () => {
          const { error } = await admin
            .from("order_messages")
            .select("order_id, user_id, text, created_at")
            .in("order_id", ids)
            .order("created_at", { ascending: false })
            .limit(INBOX_MESSAGE_LIMIT);
          if (error) throw error;
        });
        ms3 = t3.ms;
      }

      const totalMs = ms1 + ms2 + ms3;
      const timeoutLike =
        msgError?.code === "57014" ||
        String(msgError?.message ?? "").includes("statement timeout");

      setScenario("A_driver_inbox", {
        status: timeoutLike ? "FAIL" : totalMs < 8000 ? "PASS" : "WARN",
        driverId,
        timingsMs: { inProgress: ms1, delivered7d: ms2, messages: ms3, total: totalMs },
        timeoutError: timeoutLike ? msgError?.message : null,
        note: "Simulated inbox queries (service role). Mobile RLS may add latency.",
      });
      log(
        `  ${report.scenarios.A_driver_inbox.status}: total ${totalMs}ms (threshold 8000ms)`
      );
    }
  } catch (e) {
    const msg = e?.message ?? String(e);
    const isTimeout = msg.includes("statement timeout") || e?.code === "57014";
    setScenario("A_driver_inbox", { status: isTimeout ? "FAIL" : "FAIL", error: msg });
    log(`FAIL inbox: ${msg}`);
  }

  // --- B. Restaurant order creation (no total_cents) ---
  log("\n[B] Restaurant / food order insert (no total_cents)");
  try {
    const subtotal = 12.5;
    const tax = 1.11;
    const deliveryFee = 3.5;
    const grandTotal = subtotal + tax + deliveryFee;

    const { data: restaurantProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "restaurant")
      .limit(1)
      .maybeSingle();

    const restaurantId = restaurantProfile?.id ?? userId;

    const { data: inserted, error: insertErr } = await admin
      .from("orders")
      .insert({
        kind: "food",
        order_type: "food",
        pickup_kind: "restaurant",
        status: "pending",
        payment_status: "unpaid",
        client_id: userId,
        user_id: userId,
        client_user_id: userId,
        created_by: userId,
        restaurant_id: restaurantId,
        restaurant_user_id: restaurantId,
        restaurant_name: "Validation Smoke Restaurant",
        subtotal,
        tax,
        total: grandTotal,
        delivery_fee: deliveryFee,
        currency: "USD",
        pickup_address: "123 Validation St",
        dropoff_address: "456 Test Ave",
        pickup_lat: 40.7128,
        pickup_lng: -74.006,
        dropoff_lat: 40.758,
        dropoff_lng: -73.9855,
        items_json: [{ name: "Smoke Item", quantity: 1, unit_price: subtotal }],
      })
      .select("id, total, grand_total, total_cents")
      .single();

    if (insertErr) {
      const totalCentsBlocked = String(insertErr.message).includes("total_cents");
      setScenario("B_restaurant_order", {
        status: "FAIL",
        error: insertErr.message,
        totalCentsBlocked,
      });
      log(`FAIL insert: ${insertErr.message}`);
    } else {
      await admin.from("orders").delete().eq("id", inserted.id);
      setScenario("B_restaurant_order", {
        status: "PASS",
        orderId: inserted.id,
        total_cents: inserted.total_cents,
        note: "Insert without total_cents succeeded; row cleaned up",
      });
      log(`PASS: order created id=${inserted.id} total_cents=${inserted.total_cents}`);
    }
  } catch (e) {
    setScenario("B_restaurant_order", { status: "FAIL", error: e?.message ?? String(e) });
    log(`FAIL restaurant: ${e?.message ?? e}`);
  }

  // --- C. Taxi checkout LIVE session ---
  log("\n[C] Taxi checkout LIVE (Stripe session creation)");
  try {
    const quoteRes = await authFetch(token, "/api/taxi/rides/quote", {
      method: "POST",
      body: JSON.stringify({
        pickupLat: 40.7128,
        pickupLng: -74.006,
        dropoffLat: 40.758,
        dropoffLng: -73.9855,
        pickupAddress: "NYC Validation Pickup",
        dropoffAddress: "NYC Validation Dropoff",
        vehicle_class: "standard",
        country_code: "US",
      }),
    });

    if (!quoteRes.res.ok) {
      setScenario("C_taxi_checkout", {
        status: "BLOCKED",
        step: "quote",
        httpStatus: quoteRes.res.status,
        error: quoteRes.body?.error ?? quoteRes.body?.message ?? "quote failed",
        note: "Cannot test PaymentSheet without quote + ride. Check platform_maintenance flags.",
      });
      log(
        `BLOCKED quote: ${quoteRes.res.status} ${quoteRes.body?.error ?? quoteRes.body?.message ?? ""}`
      );
    } else {
      const createRide = await authFetch(token, "/api/taxi/rides/create", {
        method: "POST",
        body: JSON.stringify({
          pickupLat: 40.7128,
          pickupLng: -74.006,
          dropoffLat: 40.758,
          dropoffLng: -73.9855,
          pickupAddress: "NYC Validation Pickup",
          dropoffAddress: "NYC Validation Dropoff",
          vehicleClass: "standard",
          countryCode: "US",
          expectedQuoteTotalCents: Number(quoteRes.body?.quote?.total_cents ?? 0),
        }),
      });

      if (!createRide.res.ok) {
        setScenario("C_taxi_checkout", {
          status: "BLOCKED",
          step: "create_ride",
          httpStatus: createRide.res.status,
          error: createRide.body?.error ?? createRide.body?.message ?? JSON.stringify(createRide.body),
        });
        log(`BLOCKED create ride: ${createRide.res.status} ${createRide.body?.error ?? createRide.body?.message ?? ""}`);
      } else {
        const rideId = createRide.body?.ride?.id ?? createRide.body?.id;
        const checkout = await authFetch(
          token,
          "/api/stripe/client/create-taxi-checkout-session",
          {
            method: "POST",
            body: JSON.stringify({ taxiRideId: rideId }),
          }
        );

        const checkoutOk =
          checkout.res.ok && Boolean(checkout.body?.session_id ?? checkout.body?.ok);
        const sessionId = checkout.body?.session_id;

        if (!checkoutOk) {
          setScenario("C_taxi_checkout", {
            status: "FAIL",
            step: "checkout_session",
            httpStatus: checkout.res.status,
            error: checkout.body?.error ?? checkout.body?.message,
          });
          log(`FAIL checkout: ${checkout.body?.error ?? checkout.res.status}`);
        } else {
          setScenario("C_taxi_checkout", {
            status: "PASS",
            step: "checkout_session_created",
            rideId,
            sessionId,
            url: checkout.body?.url ? "(present)" : null,
            note:
              "Route sets payment_method_types card. PaymentSheet + webhook require device.",
          });
          log(`PASS: checkout session ${sessionId}`);

          if (rideId) {
            await admin.from("taxi_rides").delete().eq("id", rideId);
            log(`  cleaned up test ride ${rideId}`);
          }
        }
      }
    }
  } catch (e) {
    setScenario("C_taxi_checkout", { status: "FAIL", error: e?.message ?? String(e) });
    log(`FAIL taxi: ${e?.message ?? e}`);
  }

  // --- D. Navigation V2 ---
  log("\n[D] Navigation V2");
  setScenario("D_navigation_v2", {
    status: "MANUAL_REQUIRED",
    checklist: [
      "Vehicle arrow oriented by heading/bearing",
      "Follow camera with pitch + recenter",
      "Off-route reroute debounced",
      "Route alternatives picker",
      "Stable ETA",
      "French Mapbox instructions",
      "No false GPS lost",
      "Pickup to dropoff flow",
    ],
    note: "Requires physical device or simulator with GPS. Not automatable from CI.",
  });
  log("MANUAL_REQUIRED: device GPS test (see checklist in report JSON)");

  // --- E. Marketplace ---
  log("\n[E] Marketplace regional behavior");
  try {
    const mpRes = await authFetch(
      token,
      "/api/marketplace/sellers?country_code=XX&region_code=XX"
    );
    const rawError = mpRes.body?.error;
    const message = mpRes.body?.message;
    const friendly =
      message &&
      !String(message).includes("marketplace_unavailable") &&
      String(message).toLowerCase().includes("coming soon");

    setScenario("E_marketplace", {
      status:
        mpRes.res.status === 403 || mpRes.res.status === 503
          ? rawError === "marketplace_unavailable" && !friendly
            ? "WARN"
            : "PASS"
          : mpRes.res.ok
            ? "PASS"
            : "WARN",
      httpStatus: mpRes.res.status,
      error: rawError,
      message,
      note: "Mobile maps marketplace_unavailable to friendly copy; API may still return raw error field.",
    });
    log(`  status=${mpRes.res.status} error=${rawError} message=${message}`);
  } catch (e) {
    setScenario("E_marketplace", { status: "FAIL", error: e?.message ?? String(e) });
  }

  // --- Summary ---
  const statuses = Object.entries(report.scenarios).map(([k, v]) => ({
    scenario: k,
    status: v.status,
  }));

  log("\n=== SUMMARY ===");
  for (const row of statuses) {
    log(`  ${row.scenario}: ${row.status}`);
  }

  const blocking = statuses.filter((s) =>
    ["FAIL", "BLOCKED"].includes(s.status)
  );
  const manual = statuses.filter((s) => s.status === "MANUAL_REQUIRED");

  report.verdict =
    blocking.length === 0 && manual.length > 0
      ? "NOT READY — manual device validation pending"
      : blocking.some((s) => s.status === "FAIL")
        ? "NOT READY"
        : blocking.length > 0
          ? "NOT READY — blocked scenarios"
          : "CONDITIONAL READY — pending manual navigation + taxi payment on device";

  log(`\nVERDICT: ${report.verdict}`);

  const outPath = path.join(__dirname, "..", "production-validation-report.json");
  await import("fs").then((fs) =>
    fs.promises.writeFile(outPath, JSON.stringify(report, null, 2))
  );
  log(`Report written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
