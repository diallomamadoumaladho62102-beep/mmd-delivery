import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const webRoot = join(process.cwd());
const repoRoot = join(webRoot, "..", "..");

function read(rel: string) {
  return readFileSync(join(webRoot, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

// Security headers configured in Next
{
  const cfg = read("next.config.js");
  assert.match(cfg, /Content-Security-Policy/);
  assert.match(cfg, /X-Frame-Options/);
  assert.match(cfg, /Strict-Transport-Security/);
  assert.match(cfg, /X-Content-Type-Options/);
}

// Upload routes use shared validators
{
  const photo = read("app/api/locations/[id]/photo/route.ts");
  assert.match(photo, /resolveLocationPhotoContent/);
  const safety = read("app/api/taxi/rides/safety-recording/upload/route.ts");
  assert.match(safety, /resolveSafetyRecordingUpload/);
  const identity = read("app/api/driver/identity/checks/[checkId]/route.ts");
  assert.match(identity, /validateIdentitySelfiePath/);
  assert.match(identity, /assertSelfieObjectExists|selfie_missing/);
}

// Open redirect hardening
{
  const auth = read("src/lib/authValidation.ts");
  assert.match(auth, /decodeURIComponent/);
  assert.match(auth, /nested/);
}

// Cron / webhook auth still present
{
  assert.match(read("src/lib/cronAuth.ts"), /timingSafeEqual|CRON_SECRET/);
  assert.match(read("app/api/stripe/webhook/route.ts"), /constructEvent/);
}

// Admin RBAC server asserts exist
{
  assert.match(read("src/lib/adminServer.ts"), /assertStaffPermission|assertAdminAccess/);
  assert.ok(existsSync(join(webRoot, "src/components/AdminGate.tsx")));
}

// Edge CORS shared helper
{
  const cors = readRepo("supabase/functions/_shared/cors.ts");
  assert.match(cors, /buildCorsHeaders/);
  assert.match(cors, /mmddelivery\.com/);
  assert.doesNotMatch(cors, /Access-Control-Allow-Origin": "\*"/);
}

// Phase 8 migration present
{
  const mig = readRepo(
    "supabase/migrations/20260820120000_phase8_security_upload_hardening.sql"
  );
  assert.match(mig, /location-attachments/);
  assert.match(mig, /invalid_storage_path_prefix/);
  assert.match(mig, /mime_not_allowed/);
}

// Secret scan + dependency audit scripts exist
{
  assert.ok(existsSync(join(repoRoot, "scripts/secret-scan.mjs")));
  assert.ok(existsSync(join(repoRoot, "scripts/dependency-audit.mjs")));
}

console.log("phase8Security tests passed");
