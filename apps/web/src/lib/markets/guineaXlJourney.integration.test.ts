/**
 * One local process: phone queue, HTTP, the API functions, and throwaway PostgreSQL.
 * It does not start a phone, and it does not touch the linked project.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDrivingLeg } from "@/lib/mapboxRoute";
import { persistGuineaXlSegmentBooking, syncGuineaXlProgress } from "@/lib/markets/guineaXlHttp";
import { loadXlSegmentDispatchMatch } from "@/lib/markets/guineaXlSegmentDispatch";
import { XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED } from "@/lib/markets/guineaXlSegments";
import {
  readActiveXlDeparture,
  recordXlDriverAction,
  recordXlGpsFix,
  rememberActiveXlDeparture,
} from "../../../../mobile/src/lib/xlProgressRecord";
import { flushXlProgress, readXlProgress, type XlProgressStorage } from "../../../../mobile/src/lib/xlProgressQueue";
import { interpretXlProgressSyncResponse, xlProgressSyncEvents } from "../../../../../shared/xlProgressWire";

const driverId = "33333333-3333-4333-8333-333333333333";
const otherDriverId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const departureId = "e2222222-2222-4222-8222-222222222222";
const container = "mmd-xl-journey-pg";
const stops = ["Conakry", "Kindia", "Mamou", "Dalaba", "Pita", "Labé"];

type Filter = { op: "eq" | "in"; column: string; value: unknown };

class ThrowawayQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private single = false;

  constructor(
    private readonly table: string,
    private readonly columns: string,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  order(column: string) {
    this.orderColumn = column;
    return this;
  }

  maybeSingle() {
    this.single = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    try {
      const sql = this.sql();
      const data = JSON.parse(await psql(sql));
      return { data: this.single ? (Array.isArray(data) ? data[0] ?? null : data) : data, error: null };
    } catch (cause) {
      return { data: null, error: { message: cause instanceof Error ? cause.message : "query failed" } };
    }
  }

  private sql() {
    const where = this.filters.map((filter) => sqlFilter(filter)).join(" and ");
    const restriction = where ? ` where ${where}` : "";
    const order = this.orderColumn ? ` order by ${ident(this.orderColumn)}` : "";
    if (this.table === "guinea_xl_departure_segments") {
      return `select coalesce(jsonb_agg(row), '[]'::jsonb)::text from (
        select jsonb_build_object(
          'departure_id', link.departure_id,
          'position', link.position,
          'guinea_xl_segments', jsonb_build_object(
            'code', segment.code,
            'branch', segment.branch,
            'distance_km', segment.distance_km,
            'duration_minutes', segment.duration_minutes
          )
        ) as row
        from public.guinea_xl_departure_segments link
        join public.guinea_xl_segments segment on segment.id = link.segment_id
        ${restriction.replaceAll("departure_id", "link.departure_id")}
        order by link.position
      ) rows`;
    }
    if (this.table === "guinea_xl_seat_segments") {
      return `select coalesce(jsonb_agg(row), '[]'::jsonb)::text from (
        select jsonb_build_object(
          'departure_id', held.departure_id,
          'seat_index', held.seat_index,
          'booking_id', held.booking_id,
          'guinea_xl_segments', jsonb_build_object('code', segment.code)
        ) as row
        from public.guinea_xl_seat_segments held
        join public.guinea_xl_segments segment on segment.id = held.segment_id
        ${restriction.replaceAll("departure_id", "held.departure_id")}
      ) rows`;
    }
    return `select coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb)::text from (
      select * from public.${ident(this.table)}${restriction}${order}
    ) row`;
  }
}

const rpcCalls: string[] = [];

const database = {
  from(table: string) {
    return {
      select(columns: string) {
        return new ThrowawayQuery(table, columns);
      },
    };
  },
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push(name);
    try {
      const data = JSON.parse(await psql(rpcSql(name, args)));
      return { data, error: null };
    } catch (cause) {
      return { data: null, error: { message: cause instanceof Error ? cause.message : "rpc failed" } };
    }
  },
} as unknown as SupabaseClient;

function ident(value: string) {
  if (!/^[a-z_]+$/.test(value)) throw new Error(`unexpected identifier ${value}`);
  return value;
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlValue(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) return `${sqlText(value)}::uuid`;
  if (typeof value === "string") return sqlText(value);
  if (value == null) return "null";
  throw new Error("unsupported SQL value");
}

function sqlFilter(filter: Filter) {
  const column = ident(filter.column);
  if (filter.op === "eq") return `${column} = ${sqlValue(filter.value)}`;
  if (!Array.isArray(filter.value)) throw new Error("expected an IN list");
  const values = filter.value.map((value) => sqlValue(value)).join(", ");
  const cast = filter.value.every((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) ? "::uuid[]" : "";
  return `${column} = any(array[${values}]${cast})`;
}

function rpcSql(name: string, args: Record<string, unknown>) {
  if (name === "accept_guinea_xl_progress_batch") {
    return `select public.accept_guinea_xl_progress_batch(${sqlValue(args.p_driver_id)}, $json$${JSON.stringify(args.p_events)}$json$::jsonb)::text`;
  }
  if (name === "create_guinea_xl_segment_booking") {
    const baggage = Array.isArray(args.p_baggage_kg) ? args.p_baggage_kg.map((item) => sqlValue(item)).join(", ") : "";
    return `select public.create_guinea_xl_segment_booking(
      ${sqlValue(args.p_booking_id)},
      ${sqlValue(args.p_idempotency_key)},
      ${sqlValue(args.p_client_user_id)},
      ${sqlValue(args.p_departure_id)},
      ${sqlValue(args.p_seat_index)},
      ${sqlValue(args.p_origin_key)},
      ${sqlValue(args.p_destination_key)},
      array[${baggage}]::integer[],
      ${sqlValue(args.p_claimed_total_gnf)}
    )::text`;
  }
  throw new Error(`unexpected rpc ${name}`);
}

function psql(sql: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || out));
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

function docker(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: "inherit" });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker ${args[0]} exited ${code}`))));
  });
}

function memory() {
  const rows = new Map<string, string>();
  const storage: XlProgressStorage = {
    async getItem(key) {
      return rows.get(key) ?? null;
    },
    async setItem(key, value) {
      rows.set(key, value);
    },
  };
  return { rows, storage };
}

async function listen() {
  const server = http.createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    const sessionDriver = request.headers["x-test-driver"];
    const outcome =
      body.action === "book"
        ? await persistGuineaXlSegmentBooking(database, clientId, body)
        : await syncGuineaXlProgress(database, String(sessionDriver), body);
    const payload = await outcome.json();
    response.writeHead(outcome.status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function prepareDatabase() {
  await new Promise<void>((resolve) => {
    const child = spawn("docker", ["rm", "-f", container], { stdio: "ignore" });
    child.on("close", () => resolve());
  });
  await docker([
    "run",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-v",
    "C:\\DEV\\MMD-Delivery:/work",
    "postgres:16",
  ]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await psql("select 1");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await psql("select 1");
      break;
    } catch (error) {
      if (attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await psql(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    do $do$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $do$;
  `);
  for (const file of [
    "/work/supabase/migrations/20261218120000_guinea_xl_interregional.sql",
    "/work/supabase/pending/20261018120000_guinea_xl_segments.sql",
    "/work/supabase/pending/20261019120000_guinea_xl_segment_dispatch.sql",
    "/work/supabase/pending/20261020120000_guinea_xl_segment_progress.sql",
  ]) {
    await docker(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", file]);
  }
  await psql(`
    insert into auth.users (id) values ('${driverId}'), ('${otherDriverId}'), ('${clientId}') on conflict do nothing;
    create table if not exists public.taxi_driver_features (
      user_id uuid primary key,
      xl_eligible boolean not null default false
    );
    insert into public.taxi_driver_features (user_id, xl_eligible) values ('${driverId}', true)
    on conflict (user_id) do update set xl_eligible = true;
    select public.open_guinea_xl_segment_departure(
      '${departureId}',
      '${driverId}',
      4,
      null,
      array(select id from public.guinea_xl_segments where code in ('1','2','3','4','5') order by sequence)
    )::text;
  `);
}

async function runJourney() {
  await prepareDatabase();
  const { rows, storage } = memory();
  const opened = JSON.parse(await psql(`select to_jsonb(d)::text from public.guinea_xl_departures d where id = '${departureId}'`));
  assert.equal(opened.segment_run, true);
  assert.equal(opened.axis_id, null);
  const limits = JSON.parse(
    await psql("select to_jsonb(t)::text from public.guinea_xl_segment_tariff t where id = 'GN'"),
  ) as { max_pickup_meters: number };
  assert.equal(limits.max_pickup_meters, 450_000);

  const departure = { departureId, driverId, stops };
  await rememberActiveXlDeparture(storage, departure);
  const now = Date.now();
  const started = await recordXlDriverAction(storage, {
    departure,
    kind: "stop_reached",
    placement: "start",
    capturedAtMs: now,
  });
  if (started.ok === false) throw new Error(started.error);
  const offline = await flushXlProgress(storage, async () => {
    throw new Error("offline");
  });
  assert.equal(offline.synced, 0);
  assert.equal((await recordXlGpsFix(storage, { driverId, latitude: Number.NaN, longitude: -13.5, capturedAtMs: now + 500 })).queued, false);
  assert.equal((await recordXlGpsFix(storage, { driverId, latitude: 9.64, longitude: -13.58, capturedAtMs: now + 1_000 })).queued, true);
  assert.equal((await recordXlGpsFix(storage, { driverId, latitude: 9.64002, longitude: -13.58002, capturedAtMs: now + 2_000 })).queued, false);
  assert.equal((await recordXlGpsFix(storage, { driverId, latitude: 10.056, longitude: -12.865, capturedAtMs: now + 5_000 })).queued, true);
  const kindia = await recordXlDriverAction(storage, {
    departure,
    kind: "stop_reached",
    placement: "next",
    capturedAtMs: now + 6_000,
  });
  if (kindia.ok === false) throw new Error(kindia.error);
  const pickup = await recordXlDriverAction(storage, {
    departure,
    kind: "passenger_picked_up",
    placement: "current",
    capturedAtMs: now + 7_000,
  });
  if (pickup.ok === false) throw new Error(pickup.error);
  const dropoff = await recordXlDriverAction(storage, {
    departure,
    kind: "passenger_dropped_off",
    placement: "current",
    capturedAtMs: now + 8_000,
  });
  if (dropoff.ok === false) throw new Error(dropoff.error);

  const reopened: XlProgressStorage = {
    async getItem(key) {
      return rows.get(key) ?? null;
    },
    async setItem(key, value) {
      rows.set(key, value);
    },
  };
  assert.equal((await readActiveXlDeparture(reopened))?.departureId, departureId);
  assert.equal((await readXlProgress(reopened)).every((event) => event.receivedAtMs == null), true);

  const { server, url } = await listen();
  try {
    const synced = await flushXlProgress(reopened, async (pending) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-driver": driverId },
        body: JSON.stringify({
          action: "progress",
          events: xlProgressSyncEvents(pending).map((event) => ({ ...event, driver_id: otherDriverId })),
        }),
      });
      return interpretXlProgressSyncResponse(await response.json());
    });
    assert.equal(synced.synced >= 5, true);
    const storedDriver = JSON.parse(
      await psql(
        `select jsonb_build_object('driver_id', driver_id)::text from public.guinea_xl_progress_events where departure_id = '${departureId}' limit 1`,
      ),
    );
    assert.equal(storedDriver.driver_id, driverId);
    const phone = await readXlProgress(reopened);
    assert.equal(phone.every((event) => event.syncStatus === "accepted" && event.receivedAtMs != null), true);
    const again = await flushXlProgress(reopened, async () => {
      throw new Error("an accepted event was sent again");
    });
    assert.equal(again.synced, 0);

    const spoofed = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-driver": otherDriverId },
      body: JSON.stringify({
        action: "progress",
        events: [
          {
            event_id: "e1212121-2121-4121-8121-121212121212",
            departure_id: departureId,
            driver_id: driverId,
            kind: "gps",
            stop_index: null,
            lat: 1,
            lng: 1,
            captured_at: new Date().toISOString(),
            reason: null,
          },
        ],
      }),
    });
    const spoofedBody = (await spoofed.json()) as { rejected?: Array<{ error: string }> };
    assert.equal(spoofedBody.rejected?.[0]?.error, "xl_departure_unavailable");

    const measured = await loadXlSegmentDispatchMatch(database, {
      originLabel: "Dalaba",
      destinationLabel: "Pita",
      pickupLat: 10.691,
      pickupLng: -12.249,
      requestedPickupAtMs: Date.now() + 60 * 60_000,
      nowMs: Date.now(),
      measureRoad: async (from, to) => {
        try {
          return await getDrivingLeg(from, to);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "";
          console.log(message === "MAPBOX_ACCESS_TOKEN missing" ? "mapbox: token missing" : "mapbox: unavailable");
          return null;
        }
      },
    });
    const withoutRoad = measured.ok;
    const selected = await loadXlSegmentDispatchMatch(database, {
      originLabel: "Dalaba",
      destinationLabel: "Pita",
      pickupLat: 10.691,
      pickupLng: -12.249,
      requestedPickupAtMs: Date.now() + 60 * 60_000,
      nowMs: Date.now(),
      measureRoad: async () => ({ distanceMeters: 12_000, etaMinutes: 20 }),
    });
    if (selected.ok === false) throw new Error(selected.error);
    assert.equal(selected.departureId, departureId);
    assert.equal(selected.commercialBooking, false);
    console.log(
      withoutRoad
        ? "mapbox selection: selected"
        : `mapbox selection: ${measured.ok === false ? measured.error : "unknown"}`,
    );

    const callsBeforeBook = rpcCalls.length;
    const refused = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-driver": clientId },
      body: JSON.stringify({
        action: "book",
        bookingKind: "segment",
        originLabel: "Dalaba",
        destinationLabel: "Pita",
        pickupLat: 10.691,
        pickupLng: -12.249,
        requestedPickupAt: new Date().toISOString(),
        idempotencyKey: "journey-dalaba-pita",
      }),
    });
    const refusedBody = (await refused.json()) as { ok?: boolean; error?: string };
    assert.equal(refused.status, 409);
    assert.equal(refusedBody.error, "xl_segment_commercial_disabled");
    assert.equal(rpcCalls.length, callsBeforeBook);

    const unconfirmed = await database.rpc("create_guinea_xl_segment_booking", {
      p_booking_id: "e3434343-4343-4434-8434-343434343434",
      p_idempotency_key: "journey-unconfirmed",
      p_client_user_id: clientId,
      p_departure_id: departureId,
      p_seat_index: selected.seatIndex,
      p_origin_key: "dalaba",
      p_destination_key: "pita",
      p_baggage_kg: [],
      p_claimed_total_gnf: null,
    });
    assert.equal((unconfirmed.data as { error?: string }).error, "xl_segment_unconfirmed");

    await psql("update public.guinea_xl_segments set confirmed = true where code in ('4', '5')");
    const booked = await database.rpc("create_guinea_xl_segment_booking", {
      p_booking_id: "e4545454-4545-4454-8454-454545454545",
      p_idempotency_key: "journey-dalaba-pita",
      p_client_user_id: clientId,
      p_departure_id: departureId,
      p_seat_index: selected.seatIndex,
      p_origin_key: "dalaba",
      p_destination_key: "pita",
      p_baggage_kg: [],
      p_claimed_total_gnf: null,
    });
    const booking = booked.data as { ok?: boolean; booking_id?: string; total_gnf?: number };
    if (booking.ok !== true || !booking.booking_id) throw new Error(JSON.stringify(booking));
    const replay = await database.rpc("create_guinea_xl_segment_booking", {
      p_booking_id: "e5656565-6565-4565-8565-656565656565",
      p_idempotency_key: "journey-dalaba-pita",
      p_client_user_id: clientId,
      p_departure_id: departureId,
      p_seat_index: selected.seatIndex,
      p_origin_key: "dalaba",
      p_destination_key: "pita",
      p_baggage_kg: [],
      p_claimed_total_gnf: null,
    });
    assert.equal((replay.data as { idempotent?: boolean; booking_id?: string }).booking_id, booking.booking_id);
    const overlap = await database.rpc("create_guinea_xl_segment_booking", {
      p_booking_id: "e6767676-7676-4676-8676-767676767676",
      p_idempotency_key: "journey-dalaba-labe",
      p_client_user_id: clientId,
      p_departure_id: departureId,
      p_seat_index: selected.seatIndex,
      p_origin_key: "dalaba",
      p_destination_key: "labe",
      p_baggage_kg: [],
      p_claimed_total_gnf: null,
    });
    assert.equal((overlap.data as { error?: string }).error, "xl_seat_taken");
    const later = await database.rpc("create_guinea_xl_segment_booking", {
      p_booking_id: "e7878787-8787-4787-8787-878787878787",
      p_idempotency_key: "journey-pita-labe",
      p_client_user_id: clientId,
      p_departure_id: departureId,
      p_seat_index: selected.seatIndex,
      p_origin_key: "pita",
      p_destination_key: "labe",
      p_baggage_kg: [],
      p_claimed_total_gnf: null,
    });
    if ((later.data as { ok?: boolean }).ok !== true) throw new Error(JSON.stringify(later.data));
    const holds = JSON.parse(
      await psql(
        `select jsonb_build_object('holds', count(*))::text from public.guinea_xl_seat_segments where departure_id = '${departureId}' and seat_index = ${selected.seatIndex}`,
      ),
    ) as { holds: number };
    assert.equal(holds.holds >= 2, true);
    assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
    console.log(`journey booking ${booking.booking_id} total ${booking.total_gnf}`);
    console.log("guineaXlJourney.integration.test.ts passed");
  } finally {
    server.close();
  }
}

runJourney()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => docker(["rm", "-f", container]).catch(() => undefined));
