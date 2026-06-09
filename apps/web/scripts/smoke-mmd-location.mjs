import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const apiBase = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SMOKE_API_BASE_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.TEST_LOGIN_EMAIL;
const password = process.env.TEST_LOGIN_PASSWORD;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function ok(label, detail = "") {
  console.log(`OK  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function authFetch(pathname, options = {}) {
  const res = await fetch(`${apiBase}${pathname}`, options);
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function main() {
  if (!url || !anon) fail("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!email || !password) fail("Set TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD in apps/web/.env.local");

  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    fail(`Login failed: ${error?.message ?? "no session"}`);
  }

  const token = data.session.access_token;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  ok("auth", email);

  const zones = await authFetch(
    "/api/zones/search?country_code=GN&q=Matoto&limit=5",
    { method: "GET", headers }
  );
  if (!zones.res.ok || !zones.body?.ok) {
    fail(`zones/search ${zones.res.status}: ${zones.body?.error ?? "unknown"}`);
  }
  ok("GET /api/zones/search", `${(zones.body.zones ?? []).length} zones`);

  const landmarks = await authFetch(
    "/api/landmarks/search?country_code=GN&q=Total&limit=5",
    { method: "GET", headers }
  );
  if (!landmarks.res.ok || !landmarks.body?.ok) {
    fail(`landmarks/search ${landmarks.res.status}: ${landmarks.body?.error ?? "unknown"}`);
  }
  ok("GET /api/landmarks/search", `${(landmarks.body.landmarks ?? []).length} landmarks`);

  const create = await authFetch("/api/locations/create", {
    method: "POST",
    headers,
    body: JSON.stringify({
      country_code: "GN",
      region_name: "Conakry",
      prefecture_name: "Conakry",
      city_name: "Conakry",
      commune_name: "Matoto",
      quartier_name: "Lambanyi",
      directions_text: "Smoke test: after Total station, yellow house with blue gate.",
      pin_lat: 9.6378,
      pin_lng: -13.5784,
      geocoded_lat: 9.6379,
      geocoded_lng: -13.5785,
      accuracy_m: 18,
      location_source: "pin",
      primary_landmark_id: landmarks.body.landmarks?.[0]?.id ?? null,
    }),
  });

  if (!create.res.ok || !create.body?.ok || !create.body?.location?.id) {
    fail(`locations/create ${create.res.status}: ${create.body?.error ?? "unknown"}`);
  }

  const locationId = create.body.location.id;
  ok("POST /api/locations/create", locationId);

  const patch = await authFetch(`/api/locations/${locationId}/pin`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      pin_lat: 9.6381,
      pin_lng: -13.5788,
      accuracy_m: 12,
      location_source: "pin",
    }),
  });

  if (!patch.res.ok || !patch.body?.ok) {
    fail(`locations/pin ${patch.res.status}: ${patch.body?.error ?? "unknown"}`);
  }
  ok("PATCH /api/locations/[id]/pin");

  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const photo = await authFetch(`/api/locations/${locationId}/photo`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      image_base64: tinyPngBase64,
      content_type: "image/png",
    }),
  });

  if (!photo.res.ok || !photo.body?.ok || !photo.body?.photo_path) {
    fail(`locations/photo ${photo.res.status}: ${photo.body?.error ?? "unknown"}`);
  }
  ok("POST /api/locations/[id]/photo", photo.body.photo_path);

  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: bucket, error: bucketError } = await admin.storage.getBucket(
      "location-attachments"
    );

    if (bucketError) {
      fail(`Bucket location-attachments: ${bucketError.message}`);
    }
    if (!bucket || bucket.public !== false) {
      fail("Bucket location-attachments must exist and be private");
    }
    ok("Supabase bucket", "location-attachments private");

    const tables = ["location_points", "location_landmarks", "mmd_zones"];
    for (const table of tables) {
      const { error: tableError } = await admin.from(table).select("id").limit(1);
      if (tableError) {
        fail(`Table ${table}: ${tableError.message}`);
      }
      ok("Supabase table", table);
    }
  } else {
    console.warn("WARN: SUPABASE_SERVICE_ROLE_KEY not set — skipping bucket/table checks");
  }

  console.log("\nMMD Location Phase 1 smoke: ALL PASS\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
