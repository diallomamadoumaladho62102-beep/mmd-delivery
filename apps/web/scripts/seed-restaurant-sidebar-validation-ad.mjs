/**
 * Create a one-off restaurant_sidebar validation ad via the same Supabase
 * tables/bucket used by Admin CMS (no hardcoded creatives in the app).
 *
 * Usage (from apps/web):
 *   node scripts/seed-restaurant-sidebar-validation-ad.mjs
 *   node scripts/seed-restaurant-sidebar-validation-ad.mjs --deactivate
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** CRC32 for PNG chunks */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Procedural 400x200 PNG (no sharp) — soft brand-ish gradient + bar */
function buildValidationPng(width = 400, height = 200) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      const t = x / (width - 1);
      const u = y / (height - 1);
      // deep teal ? charcoal (avoid purple/cream AI clichés)
      const r = Math.round(18 + t * 40 + u * 10);
      const g = Math.round(90 + t * 50 - u * 20);
      const b = Math.round(110 - t * 30 + u * 20);
      // center band accent
      const band = Math.abs(u - 0.5) < 0.12 ? 1 : 0;
      raw[i] = Math.min(255, r + band * 80);
      raw[i + 1] = Math.min(255, g + band * 40);
      raw[i + 2] = Math.min(255, b + band * 20);
      raw[i + 3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function loadCreativeBytes(logoPath) {
  if (!existsSync(logoPath)) {
    throw new Error(`Missing creative source: ${logoPath}`);
  }
  const bytes = readFileSync(logoPath);
  // Admin/CMS uploads reject oversized assets; logo is multi-MB — use procedural PNG.
  if (bytes.length > 500 * 1024) {
    const procedural = buildValidationPng(400, 200);
    console.log(
      JSON.stringify({
        creative: "procedural_400x200_png",
        source_bytes: bytes.length,
        upload_bytes: procedural.length,
      })
    );
    return procedural;
  }
  return bytes;
}

const env = {
  ...loadEnv(resolve(__dirname, "../.env.local")),
  ...loadEnv(resolve(__dirname, "../.env")),
};

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE URL or service role key in apps/web/.env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const deactivate = process.argv.includes("--deactivate");
  const title = "MMD Pro — Développez votre restaurant";

  if (deactivate) {
    const { data, error } = await supabase
      .from("advertisements")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("placement", "restaurant_sidebar")
      .ilike("title", "%MMD Pro%")
      .select("id, title, is_active");
    if (error) throw error;
    console.log(JSON.stringify({ ok: true, deactivated: data }, null, 2));
    return;
  }

  const logoPath = resolve(__dirname, "../../mobile/assets/brand/mmd-logo.png");
  const bytes = loadCreativeBytes(logoPath);
  const path = `restaurant_sidebar/${Date.now()}-${randomBytes(4).toString("hex")}.png`;
  const { error: upErr } = await supabase.storage
    .from("advertisements")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("advertisements").getPublicUrl(path);
  const imageUrl = pub.publicUrl;

  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

  await supabase
    .from("advertisements")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("placement", "restaurant_sidebar")
    .eq("is_active", true);

  const { data, error } = await supabase
    .from("advertisements")
    .insert({
      title,
      subtitle: "Outils premium pour restaurants partenaires MMD",
      image_url: imageUrl,
      button_text: "Découvrir ?",
      button_action: "https://www.mmddelivery.com",
      placement: "restaurant_sidebar",
      category: "Campagnes MMD",
      country: "US",
      city: null,
      language: null,
      audience: "restaurant",
      priority: 100,
      display_order: 0,
      start_date: start,
      end_date: end,
      is_active: true,
    })
    .select("id, title, placement, image_url, is_active, audience, priority")
    .single();

  if (error) throw error;
  console.log(JSON.stringify({ ok: true, advertisement: data }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
