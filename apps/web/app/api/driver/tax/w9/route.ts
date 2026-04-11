import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_VERSION = "w9-verify-005-rate-limit-audit-tsfix";

const DEFAULT_BUCKET = "driver-docs";
const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;

type TinType = "SSN" | "EIN";

/**
 * ✅ IMPORTANT TS FIX
 * Ne pas forcer SupabaseClient<unknown, never, ...>
 * On garde le type réel renvoyé par createClient()
 */
type SupabaseAdmin = ReturnType<typeof createClient>;

type TaxProfileRow = {
  driver_id: string;
  signed_at: string | null;

  w9_bucket: string | null;
  w9_path: string | null;

  tin_type: TinType;
  tin_last4: string;
  tin_encrypted?: string | null;

  legal_name: string;
  business_name: string | null;
  entity_type: string;

  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;

  signed_name: string | null;
};

function parseBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeSignedUrlTTLSeconds() {
  const raw = process.env.TAX_W9_SIGNED_URL_EXPIRES_SECONDS;
  const n = Number(raw ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS;
  const ttl = Math.trunc(n);
  if (ttl < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return ttl;
}

function normalizeBucket(input: unknown) {
  const b = String(input ?? "").trim();
  if (!b) return DEFAULT_BUCKET;
  if (b === "driiver-docs") return DEFAULT_BUCKET;
  return b;
}

function onlyDigits(s: string) {
  return String(s || "").replace(/\D+/g, "");
}

function maskTin(tinLast4: string, tinType: TinType) {
  const l4 = String(tinLast4 || "").slice(-4).padStart(4, "0");
  return tinType === "SSN" ? `***-**-${l4}` : `**-*****${l4}`;
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getClientIp(req: NextRequest): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || null;
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

function getUserAgent(req: NextRequest): string | null {
  return (req.headers.get("user-agent") || "").trim() || null;
}

function createReqId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

// ---------- WebCrypto helpers (TS-safe) ----------
function b64ToU8(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf);
}
function u8ToB64(u8: Uint8Array): string {
  return Buffer.from(u8).toString("base64");
}
async function importAesKeyFromEnv(): Promise<CryptoKey> {
  const keyB64 = requireEnv("TAX_TIN_ENCRYPTION_KEY_BASE64");
  const keyBytes = b64ToU8(keyB64);
  if (keyBytes.length !== 32) {
    throw new Error("TAX_TIN_ENCRYPTION_KEY_BASE64 must decode to 32 bytes (AES-256 key)");
  }
  return crypto.webcrypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
}
// output: "v1:<iv_b64>:<tag_b64>:<ct_b64>"
async function encryptTin(tinDigits: string): Promise<string> {
  const key = await importAesKeyFromEnv();
  const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(tinDigits);
  const enc = await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const encU8 = new Uint8Array(enc);
  const tagLen = 16;
  if (encU8.length < tagLen) throw new Error("Encryption failed");
  const ct = encU8.slice(0, encU8.length - tagLen);
  const tag = encU8.slice(encU8.length - tagLen);
  return `v1:${u8ToB64(iv)}:${u8ToB64(tag)}:${u8ToB64(ct)}`;
}

// ---------- Validation ----------
type W9Body = {
  legal_name: string;
  business_name?: string | null;
  entity_type: string;

  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  zip: string;

  tin_type: TinType;
  tin?: string | null; // ✅ optional if already signed
  signed_name: string;
};

type W9Ok = {
  ok: true;
  data: {
    legal_name: string;
    business_name: string | null;
    entity_type: string;

    address_line1: string;
    address_line2: string | null;
    city: string;
    state: string;
    zip: string;

    tin_type: TinType;
    hasTinInput: boolean;
    tin_digits: string | null;
    tin_last4: string | null;

    signed_name: string;
  };
};
type W9Err = { ok: false; error: string };
type W9Validation = W9Ok | W9Err;

function isW9Err(v: W9Validation): v is W9Err {
  return v.ok === false;
}

function normalizeState(s: string) {
  return String(s ?? "").trim().toUpperCase();
}
function normalizeZip(s: string) {
  const d = onlyDigits(s);
  if (d.length === 5) return d;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return String(s ?? "").trim();
}

function validateW9(body: any, opts: { allowTinOptional: boolean }): W9Validation {
  const b = body as Partial<W9Body>;

  const legal = String(b?.legal_name ?? "").trim();
  const business = String(b?.business_name ?? "").trim() || null;
  const entity = String(b?.entity_type ?? "").trim();

  const a1 = String(b?.address_line1 ?? "").trim();
  const a2 = String(b?.address_line2 ?? "").trim() || null;
  const city = String(b?.city ?? "").trim();
  const state = normalizeState(String(b?.state ?? "").trim());
  const zip = normalizeZip(String(b?.zip ?? "").trim());

  const signed = String(b?.signed_name ?? "").trim();

  const tinType: TinType | null = b?.tin_type === "EIN" ? "EIN" : b?.tin_type === "SSN" ? "SSN" : null;
  if (!tinType) return { ok: false as const, error: "tin_type must be SSN or EIN" };

  if (!legal) return { ok: false as const, error: "legal_name is required" };
  if (!entity) return { ok: false as const, error: "entity_type is required" };
  if (!a1 || !city || !state || !zip) return { ok: false as const, error: "address fields are required" };
  if (!signed) return { ok: false as const, error: "signed_name is required" };

  if (!/^[A-Z]{2}$/.test(state)) return { ok: false as const, error: "state must be a 2-letter code (e.g., NJ)" };

  const zipDigits = onlyDigits(zip);
  if (!(zipDigits.length === 5 || zipDigits.length === 9)) return { ok: false as const, error: "zip must be 5 digits (or ZIP+4)" };

  const tinRaw = String(b?.tin ?? "").trim();
  const tinDigits = onlyDigits(tinRaw);
  const hasTinInput = tinDigits.length > 0;

  if (!opts.allowTinOptional) {
    if (!hasTinInput || tinDigits.length !== 9) return { ok: false as const, error: `${tinType} must be 9 digits` };
  } else {
    if (hasTinInput && tinDigits.length !== 9) return { ok: false as const, error: `${tinType} must be 9 digits` };
  }

  const tinLast4 = hasTinInput ? tinDigits.slice(-4) : null;

  return {
    ok: true as const,
    data: {
      legal_name: legal,
      business_name: business,
      entity_type: entity,
      address_line1: a1,
      address_line2: a2,
      city,
      state,
      zip,
      tin_type: tinType,
      hasTinInput,
      tin_digits: hasTinInput ? tinDigits : null,
      tin_last4: tinLast4,
      signed_name: signed,
    },
  };
}

// ---------- PDF ----------
async function buildW9Pdf(params: {
  driverId: string;
  legal_name: string;
  business_name: string | null;
  entity_type: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip: string;
  tin_type: TinType;
  tin_last4: string;
  signed_name: string;
  signed_at_iso: string;
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const C_TEXT = rgb(0.09, 0.09, 0.11);
  const C_MUTED = rgb(0.42, 0.44, 0.50);
  const C_BORDER = rgb(0.90, 0.91, 0.93);
  const C_HEAD = rgb(0.965, 0.968, 0.975);

  const M = 44;
  const W = 612;
  const H = 792;

  const drawText = (t: string, x: number, y: number, size = 11, isBold = false, color = C_TEXT) => {
    page.drawText(t, { x, y, size, font: isBold ? bold : font, color });
  };

  page.drawRectangle({ x: 0, y: H, width: W, height: 84, color: C_HEAD, borderColor: C_BORDER, borderWidth: 1 });
  drawText("MMD Delivery", M, H - 34, 16, true);
  drawText("W-9 Tax Information (Certification)", M, H - 56, 11, false, C_MUTED);

  const rightX = W - M - 260;
  drawText(`Driver ID: ${params.driverId.slice(0, 8)}…`, rightX, H - 34, 9.5, false, C_MUTED);
  drawText(`Signed: ${params.signed_at_iso.slice(0, 10)}`, rightX, H - 50, 9.5, false, C_MUTED);

  let y = H - 120;

  const field = (label: string, value: string) => {
    drawText(label, M, y, 9.5, false, C_MUTED);
    drawText(value || "—", M, y - 18, 12, true, C_TEXT);
    page.drawLine({ start: { x: M, y: y - 26 }, end: { x: W - M, y: y - 26 }, thickness: 1, color: C_BORDER });
    y -= 52;
  };

  field("Legal name (W-9 Line 1)", params.legal_name);
  field("Business name (W-9 Line 2, optional)", params.business_name ?? "—");
  field("Federal tax classification (entity type)", params.entity_type);

  const addr2 = params.address_line2 ? `, ${params.address_line2}` : "";
  field("Address", `${params.address_line1}${addr2}, ${params.city}, ${params.state} ${params.zip}`);

  field("Taxpayer Identification Number (masked)", maskTin(params.tin_last4, params.tin_type));

  y -= 8;
  drawText("Certification", M, y, 12, true, C_TEXT);
  y -= 18;

  const cert =
    "Under penalties of perjury, I certify that: (1) the number shown on this form is my correct taxpayer identification number; " +
    "(2) I am not subject to backup withholding due to failure to report interest/dividends; and (3) I am a U.S. person (including a U.S. resident alien).";

  const maxW = W - M * 2;
  const words = cert.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(cand, 9.8);
    if (width <= maxW) line = cand;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);

  for (const ln of lines) {
    drawText(ln, M, y, 9.8, false, C_MUTED);
    y -= 13;
  }

  y -= 8;
  drawText("Signature", M, y, 9.5, false, C_MUTED);
  drawText(params.signed_name, M, y - 18, 12, true, C_TEXT);
  drawText("Date", W - M - 120, y, 9.5, false, C_MUTED);
  drawText(params.signed_at_iso.slice(0, 10), W - M - 120, y - 18, 12, true, C_TEXT);

  page.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, thickness: 1, color: C_BORDER });
  drawText("This document is an electronically signed W-9 information certification for MMD Delivery.", M, 38, 8.6, false, C_MUTED);

  return await pdfDoc.save();
}

// ---------- Stripe-level: rate limit + audit log ----------
type RateRule = { windowSeconds: number; max: number };
const RATE_RULES: Record<"w9.get" | "w9.submit", RateRule[]> = {
  "w9.get": [
    { windowSeconds: 60, max: 30 }, // 30/min
    { windowSeconds: 3600, max: 300 }, // 300/hour
  ],
  "w9.submit": [
    { windowSeconds: 60, max: 5 }, // 5/min
    { windowSeconds: 3600, max: 30 }, // 30/hour
  ],
};

function windowStartISO(now: Date, windowSeconds: number) {
  const t = Math.floor(now.getTime() / 1000);
  const start = Math.floor(t / windowSeconds) * windowSeconds;
  return new Date(start * 1000).toISOString();
}

function rateKey(action: string, driverId: string, windowSeconds: number, windowStartIso: string) {
  return `tax:${action}:driver:${driverId}:w${windowSeconds}:${windowStartIso}`;
}

async function checkRateLimitOrThrow(params: {
  supabaseAdmin: SupabaseAdmin;
  driverId: string;
  action: "w9.get" | "w9.submit";
}) {
  const now = new Date();

  for (const rule of RATE_RULES[params.action]) {
    const ws = windowStartISO(now, rule.windowSeconds);
    const key = rateKey(params.action, params.driverId, rule.windowSeconds, ws);

    const sel = await params.supabaseAdmin
      .from("tax_rate_limits")
      .select("key,count,window_start,window_seconds")
      .eq("key", key)
      .maybeSingle();

    if (sel.error) {
      // fail-safe: ne pas bloquer si la table rate_limit a un souci
      continue;
    }

    const currentCount = (sel.data as any)?.count ?? 0;
    if (currentCount >= rule.max) {
      const retryAfter = Math.max(1, rule.windowSeconds - Math.floor((now.getTime() - new Date(ws).getTime()) / 1000));
      const err: any = new Error("Rate limit exceeded");
      err.code = "RATE_LIMITED";
      err.httpStatus = 429;
      err.retryAfter = retryAfter;
      err.rule = rule;
      throw err;
    }

    // increment best-effort
    if (!sel.data) {
      const ins = await params.supabaseAdmin.from("tax_rate_limits").insert([
        {
          key,
          window_start: ws,
          window_seconds: rule.windowSeconds,
          count: 1,
        },
      ]);

      if (ins.error) {
        await params.supabaseAdmin
          .from("tax_rate_limits")
          .update({ count: currentCount + 1, updated_at: new Date().toISOString() })
          .eq("key", key);
      }
    } else {
      await params.supabaseAdmin
        .from("tax_rate_limits")
        .update({ count: currentCount + 1, updated_at: new Date().toISOString() })
        .eq("key", key);
    }
  }
}

async function auditLog(params: {
  supabaseAdmin: SupabaseAdmin;
  req: NextRequest;
  driverId: string;
  action: "w9.get" | "w9.submit";
  ok: boolean;
  httpStatus: number;
  tinType?: TinType | null;
  tinLast4?: string | null;
  bucket?: string | null;
  w9Path?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: any;
}) {
  const ip = getClientIp(params.req);
  const ua = getUserAgent(params.req);

  // IMPORTANT: jamais de TIN complet, jamais de tin_encrypted ici
  await params.supabaseAdmin.from("tax_audit_logs").insert([
    {
      driver_id: params.driverId,
      action: params.action,
      ok: params.ok,
      route_version: ROUTE_VERSION,
      http_status: params.httpStatus,
      ip,
      user_agent: ua,
      tin_type: params.tinType ?? null,
      tin_last4: params.tinLast4 ?? null,
      w9_path: params.w9Path ?? null,
      bucket: params.bucket ?? null,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage?.slice(0, 500) ?? null,
      metadata: params.metadata ?? {},
    },
  ]);
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  const reqId = createReqId();

  let supabaseAdmin: SupabaseAdmin | null = null;
  let driverId: string | null = null;

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Missing env" }, { status: 500 });
    }

    const token = parseBearerToken(req);
    if (!token) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userRes?.user?.id) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Invalid token" }, { status: 401 });
    }

    driverId = userRes.user.id;

    await checkRateLimitOrThrow({ supabaseAdmin, driverId, action: "w9.get" });

    const roleResp = await supabaseAdmin.from("profiles").select("role").eq("id", driverId).single();
    if (roleResp.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.get", ok: false, httpStatus: 500, errorCode: "ROLE_CHECK_FAILED", errorMessage: roleResp.error.message, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Unable to verify role" }, { status: 500 });
    }
    if ((roleResp.data?.role ?? null) !== "driver") {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.get", ok: false, httpStatus: 403, errorCode: "FORBIDDEN", errorMessage: "driver role required", metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Forbidden: driver role required" }, { status: 403 });
    }

    const tp = await supabaseAdmin
      .from("tax_profiles")
      .select(
        [
          "driver_id",
          "signed_at",
          "w9_bucket",
          "w9_path",
          "tin_type",
          "tin_last4",
          "legal_name",
          "business_name",
          "entity_type",
          "address_line1",
          "address_line2",
          "city",
          "state",
          "zip",
          "signed_name",
        ].join(",")
      )
      .eq("driver_id", driverId)
      .maybeSingle();

    if (tp.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.get", ok: false, httpStatus: 500, errorCode: "DB_READ_FAILED", errorMessage: tp.error.message, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: tp.error.message }, { status: 500 });
    }

    const row = (tp.data as unknown as TaxProfileRow | null) ?? null;
    if (!row) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.get", ok: true, httpStatus: 200, metadata: { reqId, status: "missing" } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, status: "missing" }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const usedBucket = normalizeBucket(row.w9_bucket || process.env.TAX_W9_BUCKET || DEFAULT_BUCKET);
    const storagePath = row.w9_path || null;

    let signedUrl: string | null = null;
    if (storagePath) {
      const signedResp = await supabaseAdmin.storage.from(usedBucket).createSignedUrl(storagePath, safeSignedUrlTTLSeconds());
      if (!signedResp.error && signedResp.data?.signedUrl) signedUrl = signedResp.data.signedUrl;
    }

    await auditLog({
      supabaseAdmin,
      req,
      driverId,
      action: "w9.get",
      ok: true,
      httpStatus: 200,
      tinType: row.tin_type,
      tinLast4: row.tin_last4,
      bucket: usedBucket,
      w9Path: storagePath,
      metadata: { reqId, status: "signed" },
    });

    return NextResponse.json(
      {
        routeVersion: ROUTE_VERSION,
        reqId,
        status: "signed",
        signedAt: row.signed_at,
        tin: { type: row.tin_type, masked: maskTin(row.tin_last4, row.tin_type) },
        profile: {
          legalName: row.legal_name,
          businessName: row.business_name ?? "",
          entityType: row.entity_type,
          address1: row.address_line1 ?? "",
          address2: row.address_line2 ?? "",
          city: row.city ?? "",
          state: row.state ?? "",
          zip: row.zip ?? "",
          signedName: row.signed_name ?? row.legal_name ?? "",
        },
        file: storagePath ? { bucket: usedBucket, path: storagePath, signedUrl } : null,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const httpStatus = Number(e?.httpStatus) || (e?.code === "RATE_LIMITED" ? 429 : 500);
    const retryAfter = e?.retryAfter ? String(e.retryAfter) : null;

    // best-effort audit si possible
    try {
      if (supabaseAdmin && driverId) {
        await auditLog({
          supabaseAdmin,
          req,
          driverId,
          action: "w9.get",
          ok: false,
          httpStatus,
          errorCode: e?.code ?? "UNHANDLED",
          errorMessage: e?.message ?? "Unknown error",
          metadata: { reqId, retryAfter, rule: e?.rule ?? null },
        });
      }
    } catch {
      // ignore
    }

    const res = NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: e?.message ?? "Unknown error" }, { status: httpStatus });
    if (retryAfter) res.headers.set("Retry-After", retryAfter);
    return res;
  }
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  const reqId = createReqId();

  let supabaseAdmin: SupabaseAdmin | null = null;
  let driverId: string | null = null;

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Missing env" }, { status: 500 });
    }

    const token = parseBearerToken(req);
    if (!token) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userRes?.user?.id) {
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Invalid token" }, { status: 401 });
    }

    driverId = userRes.user.id;

    await checkRateLimitOrThrow({ supabaseAdmin, driverId, action: "w9.submit" });

    const roleResp = await supabaseAdmin.from("profiles").select("role").eq("id", driverId).single();
    if (roleResp.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 500, errorCode: "ROLE_CHECK_FAILED", errorMessage: roleResp.error.message, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Unable to verify role" }, { status: 500 });
    }
    if ((roleResp.data?.role ?? null) !== "driver") {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 403, errorCode: "FORBIDDEN", errorMessage: "driver role required", metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "Forbidden: driver role required" }, { status: 403 });
    }

    const existing = await supabaseAdmin
      .from("tax_profiles")
      .select("driver_id,tin_last4,tin_type,tin_encrypted")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (existing.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 500, errorCode: "DB_READ_FAILED", errorMessage: existing.error.message, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: existing.error.message }, { status: 500 });
    }

    const existingRow =
      (existing.data as unknown as Pick<TaxProfileRow, "tin_last4" | "tin_type" | "tin_encrypted"> | null) ?? null;

    const alreadySigned = Boolean(existingRow);

    const body = await req.json().catch(() => null);
    const v = validateW9(body, { allowTinOptional: alreadySigned });
    if (isW9Err(v)) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 400, errorCode: "VALIDATION", errorMessage: v.error, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: v.error }, { status: 400 });
    }

    const usedBucket = normalizeBucket(process.env.TAX_W9_BUCKET || DEFAULT_BUCKET);
    const signedAtIso = new Date().toISOString();

    // Decide TIN update (jamais en clair; audit: seulement last4)
    let finalTinType: TinType = v.data.tin_type;
    let finalTinLast4: string;
    let finalTinEncrypted: string | null = null;

    if (v.data.hasTinInput && v.data.tin_digits && v.data.tin_last4) {
      finalTinLast4 = v.data.tin_last4;
      finalTinEncrypted = await encryptTin(v.data.tin_digits);
    } else {
      // user kept blank
      if (!existingRow?.tin_last4 || !existingRow?.tin_type) {
        await auditLog({
          supabaseAdmin,
          req,
          driverId,
          action: "w9.submit",
          ok: false,
          httpStatus: 400,
          errorCode: "TIN_REQUIRED",
          errorMessage: "TIN is required for first-time W-9 submission",
          metadata: { reqId },
        });
        return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: "TIN is required for first-time W-9 submission" }, { status: 400 });
      }
      finalTinType = existingRow.tin_type as TinType;
      finalTinLast4 = existingRow.tin_last4 as string;
      finalTinEncrypted = null; // do not overwrite
    }

    const pdfBytes = await buildW9Pdf({
      driverId,
      legal_name: v.data.legal_name,
      business_name: v.data.business_name ?? null,
      entity_type: v.data.entity_type,
      address_line1: v.data.address_line1,
      address_line2: v.data.address_line2 ?? null,
      city: v.data.city,
      state: v.data.state,
      zip: v.data.zip,
      tin_type: finalTinType,
      tin_last4: finalTinLast4!,
      signed_name: v.data.signed_name,
      signed_at_iso: signedAtIso,
    });

    const storagePath = `driver-tax/${driverId}/w9/w9.pdf`;

    const uploadResp = await supabaseAdmin.storage.from(usedBucket).upload(storagePath, Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });

    if (uploadResp.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 500, errorCode: "STORAGE_UPLOAD", errorMessage: uploadResp.error.message, bucket: usedBucket, w9Path: storagePath, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: uploadResp.error.message ?? "Storage upload failed" }, { status: 500 });
    }

    // Upsert DB (ne pas écraser tin_* si user a laissé vide)
    const row: any = {
      driver_id: driverId,
      legal_name: v.data.legal_name,
      business_name: v.data.business_name ?? null,
      entity_type: v.data.entity_type,
      address_line1: v.data.address_line1,
      address_line2: v.data.address_line2 ?? null,
      city: v.data.city,
      state: v.data.state,
      zip: v.data.zip,
      signed_name: v.data.signed_name,
      signed_at: signedAtIso,
      w9_bucket: usedBucket,
      w9_path: storagePath,
    };

    if (finalTinEncrypted) {
      row.tin_type = finalTinType;
      row.tin_encrypted = finalTinEncrypted;
      row.tin_last4 = finalTinLast4;
    }

    const upsertResp = await supabaseAdmin.from("tax_profiles").upsert([row], { onConflict: "driver_id" });
    if (upsertResp.error) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 500, errorCode: "DB_UPSERT", errorMessage: upsertResp.error.message, bucket: usedBucket, w9Path: storagePath, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: upsertResp.error.message ?? "DB upsert failed" }, { status: 500 });
    }

    const signedResp = await supabaseAdmin.storage.from(usedBucket).createSignedUrl(storagePath, safeSignedUrlTTLSeconds());
    if (signedResp.error || !signedResp.data?.signedUrl) {
      await auditLog({ supabaseAdmin, req, driverId, action: "w9.submit", ok: false, httpStatus: 500, errorCode: "SIGNED_URL", errorMessage: signedResp.error?.message ?? "Signed URL failed", bucket: usedBucket, w9Path: storagePath, metadata: { reqId } });
      return NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: signedResp.error?.message ?? "Signed URL failed" }, { status: 500 });
    }

    await auditLog({
      supabaseAdmin,
      req,
      driverId,
      action: "w9.submit",
      ok: true,
      httpStatus: 200,
      tinType: finalTinType,
      tinLast4: finalTinLast4!,
      bucket: usedBucket,
      w9Path: storagePath,
      metadata: { reqId, tinUpdated: Boolean(finalTinEncrypted) },
    });

    return NextResponse.json(
      {
        routeVersion: ROUTE_VERSION,
        reqId,
        status: "signed",
        signedAt: signedAtIso,
        tin: { type: finalTinType, masked: maskTin(finalTinLast4!, finalTinType) },
        file: {
          bucket: usedBucket,
          path: storagePath,
          signedUrl: signedResp.data.signedUrl,
          expiresInSeconds: safeSignedUrlTTLSeconds(),
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const httpStatus = Number(e?.httpStatus) || (e?.code === "RATE_LIMITED" ? 429 : 500);
    const retryAfter = e?.retryAfter ? String(e.retryAfter) : null;

    try {
      if (supabaseAdmin && driverId) {
        await auditLog({
          supabaseAdmin,
          req,
          driverId,
          action: "w9.submit",
          ok: false,
          httpStatus,
          errorCode: e?.code ?? "UNHANDLED",
          errorMessage: e?.message ?? "Unknown error",
          metadata: { reqId, retryAfter, rule: e?.rule ?? null },
        });
      }
    } catch {
      // ignore
    }

    const res = NextResponse.json({ routeVersion: ROUTE_VERSION, reqId, error: e?.message ?? "Unknown error" }, { status: httpStatus });
    if (retryAfter) res.headers.set("Retry-After", retryAfter);
    return res;
  }
}
