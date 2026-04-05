// apps/web/src/app/api/driver/tax/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_VERSION = "tax-summary-verify-006-storage-debug-retry-super-pro";

// Defaults / limits
const DEFAULT_BUCKET = "driver-docs";
const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;

type OrderRow = {
  id: string;
  created_at: string | null;
  delivered_confirmed_at: string | null;
  status: string | null;
  payment_status: string | null;

  currency: string | null;

  restaurant_id: string | null;
  restaurant_name: string | null;

  pickup_address: string | null;
  dropoff_address: string | null;

  subtotal_cents: number | null;
  tax_cents: number | null;
  delivery_fee_cents: number | null;
  total_cents: number | null;

  subtotal: number | null;
  tax: number | null;
  delivery_fee: number | null;
  total: number | null;

  tip: number | null;
  tip_cents: number | null;

  driver_delivery_payout: number | null;
  platform_delivery_fee: number | null;

  paid_at: string | null;
};

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      routeVersion: ROUTE_VERSION,
      error,
      ...(extra ?? {}),
    },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function errorMessage(e: unknown) {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  return "Unknown error";
}

function normalizeBucket(input: unknown) {
  const b = String(input ?? "").trim();
  if (!b) return DEFAULT_BUCKET;
  if (b === "driiver-docs") return DEFAULT_BUCKET;
  return b;
}

function parseBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeSignedUrlTTLSeconds() {
  const raw = process.env.TAX_PDF_SIGNED_URL_EXPIRES_SECONDS;
  const n = Number(raw ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(n)) return DEFAULT_TTL_SECONDS;
  const ttl = Math.trunc(n);
  if (ttl < MIN_TTL_SECONDS) return MIN_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS) return MAX_TTL_SECONDS;
  return ttl;
}

function safeYearFromRequest(req: NextRequest) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const fallback = new Date().getUTCFullYear() - 1;

  const year = yearParam ? Number(yearParam) : fallback;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return { ok: false as const, error: "Invalid year" };
  }

  const y = Math.trunc(year);
  if (String(y) !== String(year)) {
    return { ok: false as const, error: "Invalid year" };
  }

  return { ok: true as const, year: y };
}

function getYearRangeUTC(year: number) {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0));
  return { start, end };
}

function safeNumber(n: unknown) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function isoDateYYYYMMDD(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function monthKeyUTC(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function money(n: number, currency = "USD") {
  const v = Number.isFinite(n) ? n : 0;
  if (currency === "USD") return `$${v.toFixed(2)}`;
  return `${v.toFixed(2)} ${currency}`;
}

function pickAmountUSD({
  cents,
  amount,
}: {
  cents: number | null | undefined;
  amount: number | null | undefined;
}) {
  const a = amount != null ? safeNumber(amount) : 0;
  if (amount != null) return a;

  const c = cents != null ? safeNumber(cents) : 0;
  return c / 100;
}

function safeTipAmountUSD(o: OrderRow) {
  if (o.tip != null) return safeNumber(o.tip);
  if (o.tip_cents != null) return safeNumber(o.tip_cents) / 100;
  return 0;
}

async function loadLogoPngBytes(): Promise<Uint8Array | null> {
  const candidates: string[] = [];

  const envPath = String(process.env.MMD_LOGO_PNG_PATH ?? "").trim();
  if (envPath) candidates.push(envPath);

  const cwd = process.cwd();
  candidates.push(path.join(cwd, "public", "brand", "mmd-logo.png"));
  candidates.push(path.join(cwd, "public", "mmd-logo.png"));
  candidates.push(path.join(cwd, "apps", "web", "public", "brand", "mmd-logo.png"));
  candidates.push(path.join(cwd, "apps", "web", "public", "mmd-logo.png"));

  for (const p of candidates) {
    try {
      const buf = await fs.readFile(p);
      if (buf?.byteLength) return new Uint8Array(buf);
    } catch {}
  }

  return null;
}

// ===== PDF text helpers =====
function textWidth(font: PDFFont, text: string, size: number) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

function fitTextToWidth(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  ellipsis = "…"
) {
  const t = String(text ?? "").trim();
  if (!t) return "—";
  if (textWidth(font, t, size) <= maxWidth) return t;

  const eW = textWidth(font, ellipsis, size);
  const limit = Math.max(0, maxWidth - eW);

  let lo = 0;
  let hi = t.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = t.slice(0, mid);
    if (textWidth(font, s, size) <= limit) lo = mid;
    else hi = mid - 1;
  }

  const cut = Math.max(0, lo);
  const out = t.slice(0, cut).trimEnd();
  return out ? out + ellipsis : ellipsis;
}

function wrapTextByWidth(font: PDFFont, text: string, size: number, maxWidth: number) {
  const t = String(text ?? "").trim();
  if (!t) return ["—"];

  const words = t.split(/\s+/g);
  const lines: string[] = [];
  let line = "";

  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (textWidth(font, cand, size) <= maxWidth) {
      line = cand;
      continue;
    }

    if (line) lines.push(line);

    if (textWidth(font, w, size) > maxWidth) {
      lines.push(fitTextToWidth(font, w, size, maxWidth));
      line = "";
    } else {
      line = w;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

function getPdfMode(req: NextRequest) {
  const url = new URL(req.url);

  const details = url.searchParams.get("details") === "1";
  const compact = url.searchParams.get("compact") !== "0";
  const addressMode = (url.searchParams.get("address") || "masked").toLowerCase();
  const address: "masked" | "full" = addressMode === "full" ? "full" : "masked";
  const includeBusinessTotals = url.searchParams.get("include_business") === "1";

  return { details, compact, address, includeBusinessTotals };
}

function maskAddress(s: string) {
  const t = String(s || "").trim();
  if (!t) return "—";
  const noZip = t.replace(/\s+\d{5}(?:-\d{4})?\b/g, "").trim();
  return noZip.length > 64 ? `${noZip.slice(0, 63)}…` : noZip;
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const envBucketRaw = process.env.TAX_PDF_BUCKET || DEFAULT_BUCKET;
    const usedBucket = normalizeBucket(envBucketRaw);
    const signedUrlExpiresSeconds = safeSignedUrlTTLSeconds();

    if (!supabaseUrl || !serviceKey) {
      return jsonError(
        500,
        "Missing env (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
      );
    }

    const token = parseBearerToken(req);
    if (!token) {
      return jsonError(401, "Missing Authorization Bearer token");
    }

    const yr = safeYearFromRequest(req);
    if (!yr.ok) {
      return jsonError(400, yr.error);
    }
    const year = yr.year;

    const { details, compact, address, includeBusinessTotals } = getPdfMode(req);

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let driverId = "";

    try {
      const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);

      if (userErr || !userRes?.user?.id) {
        return jsonError(401, "Invalid token", {
          stage: "auth.getUser",
          details: userErr?.message ?? null,
        });
      }

      driverId = userRes.user.id;
    } catch (e) {
      return jsonError(500, "Failed to validate token", {
        stage: "auth.getUser",
        details: errorMessage(e),
      });
    }

    try {
      const roleResp = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", driverId)
        .single();

      if (roleResp.error) {
        return jsonError(500, "Unable to verify role", {
          stage: "profiles.select.role",
          details: roleResp.error.message,
          driverId,
        });
      }

      const role = (roleResp.data?.role ?? null) as string | null;
      if (role !== "driver") {
        return jsonError(403, "Forbidden: driver role required", {
          stage: "profiles.role.check",
          driverId,
          role,
        });
      }
    } catch (e) {
      return jsonError(500, "Role verification failed", {
        stage: "profiles.select.role",
        details: errorMessage(e),
        driverId,
      });
    }

    const { start, end } = getYearRangeUTC(year);
    const dateFrom = start.toISOString();
    const dateTo = end.toISOString();

    let orders: OrderRow[] = [];

    try {
      const resp = await supabaseAdmin
        .from("orders")
        .select(
          [
            "id",
            "created_at",
            "delivered_confirmed_at",
            "status",
            "payment_status",
            "currency",
            "restaurant_id",
            "restaurant_name",
            "pickup_address",
            "dropoff_address",
            "subtotal_cents",
            "tax_cents",
            "delivery_fee_cents",
            "total_cents",
            "subtotal",
            "tax",
            "delivery_fee",
            "total",
            "tip",
            "tip_cents",
            "driver_delivery_payout",
            "platform_delivery_fee",
            "paid_at",
          ].join(",")
        )
        .eq("driver_id", driverId)
        .eq("status", "delivered")
        .eq("payment_status", "paid")
        .or(
          `and(delivered_confirmed_at.gte.${dateFrom},delivered_confirmed_at.lt.${dateTo}),and(delivered_confirmed_at.is.null,created_at.gte.${dateFrom},created_at.lt.${dateTo})`
        )
        .order("created_at", { ascending: true });

      if (resp.error) {
        return jsonError(500, resp.error.message ?? "Query failed", {
          stage: "orders.select",
          driverId,
          year,
          dateFrom,
          dateTo,
        });
      }

      orders = ((resp.data ?? []) as unknown as OrderRow[]).filter(Boolean);
    } catch (e) {
      return jsonError(500, "Failed to load orders", {
        stage: "orders.select",
        details: errorMessage(e),
        driverId,
        year,
        dateFrom,
        dateTo,
      });
    }

    const currency = orders[0]?.currency || "USD";

    let grossDeliveryFees = 0;
    let platformFees = 0;
    let driverBasePayout = 0;
    let tips = 0;

    let totalOrderAmount = 0;
    let subtotalAmount = 0;
    let taxAmount = 0;

    const monthly = new Map<
      string,
      {
        deliveries: number;
        driverBase: number;
        tips: number;
      }
    >();

    for (const o of orders) {
      const fee = pickAmountUSD({
        cents: o.delivery_fee_cents,
        amount: o.delivery_fee,
      });
      const plat = safeNumber(o.platform_delivery_fee);
      const drv = safeNumber(o.driver_delivery_payout);
      const tipVal = safeTipAmountUSD(o);

      const sub = pickAmountUSD({
        cents: o.subtotal_cents,
        amount: o.subtotal,
      });
      const taxV = pickAmountUSD({
        cents: o.tax_cents,
        amount: o.tax,
      });
      const tot = pickAmountUSD({
        cents: o.total_cents,
        amount: o.total,
      });

      grossDeliveryFees += fee;
      platformFees += plat;
      driverBasePayout += drv;
      tips += tipVal;

      subtotalAmount += sub;
      taxAmount += taxV;
      totalOrderAmount += tot;

      const effectiveDate = o.delivered_confirmed_at ?? o.created_at;
      const mk = monthKeyUTC(effectiveDate);

      if (mk) {
        const row = monthly.get(mk) ?? {
          deliveries: 0,
          driverBase: 0,
          tips: 0,
        };

        row.deliveries += 1;
        row.driverBase += drv;
        row.tips += tipVal;

        monthly.set(mk, row);
      }
    }

    const totalDeliveries = orders.length;
    const driverTotal = driverBasePayout + tips;

    let pdfBytes: Uint8Array;
    let logoUsed = false;

    try {
      const pdfDoc = await PDFDocument.create();

      const PAGE_W = 612;
      const PAGE_H = 792;
      const MARGIN_X = 44;

      const HEADER_H = 84;
      const FOOTER_H = 56;

      const TOP_Y = PAGE_H - 18;
      const CONTENT_TOP = PAGE_H - HEADER_H - 14;
      const MIN_Y = FOOTER_H + 10;

      const C_TEXT = rgb(0.09, 0.09, 0.11);
      const C_MUTED = rgb(0.42, 0.44, 0.50);
      const C_BORDER = rgb(0.90, 0.91, 0.93);
      const C_SURFACE = rgb(0.98, 0.98, 0.99);
      const C_HEAD_BG = rgb(0.965, 0.968, 0.975);
      const C_BRAND = rgb(0.38, 0.35, 0.97);
      const C_BRAND_DARK = rgb(0.20, 0.18, 0.85);

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      let logoPng: any = null;
      try {
        const logoBytes = await loadLogoPngBytes();
        if (logoBytes) {
          logoPng = await pdfDoc.embedPng(logoBytes);
          logoUsed = true;
        }
      } catch {
        logoPng = null;
        logoUsed = false;
      }

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = CONTENT_TOP;

      const nowIso = new Date().toISOString();
      const reportId = `MMD-TAX-${year}-${driverId.slice(0, 8)}`;

      const drawText = (
        text: string,
        x: number,
        yy: number,
        size = 12,
        bold = false,
        color = C_TEXT
      ) => {
        page.drawText(text, {
          x,
          y: yy,
          size,
          font: bold ? boldFont : font,
          color,
        });
      };

      const drawTextRight = (
        text: string,
        rightX: number,
        yy: number,
        size = 12,
        bold = false,
        color = C_TEXT
      ) => {
        const f = bold ? boldFont : font;
        const w = textWidth(f, text, size);
        page.drawText(text, {
          x: rightX - w,
          y: yy,
          size,
          font: f,
          color,
        });
      };

      const hr = (yy: number) => {
        page.drawLine({
          start: { x: MARGIN_X, y: yy },
          end: { x: PAGE_W - MARGIN_X, y: yy },
          thickness: 1,
          color: C_BORDER,
        });
      };

      const rect = (
        x: number,
        yy: number,
        w: number,
        h: number,
        fill = C_SURFACE,
        border = C_BORDER
      ) => {
        page.drawRectangle({
          x,
          y: yy - h,
          width: w,
          height: h,
          color: fill,
          borderColor: border,
          borderWidth: 1,
        });
      };

      const drawLogo = (x: number, yy: number) => {
        const logoBox = 22;

        if (logoPng) {
          const iw = logoPng.width;
          const ih = logoPng.height;
          const scale = Math.min(logoBox / iw, logoBox / ih);
          const w = iw * scale;
          const h = ih * scale;

          page.drawImage(logoPng, { x, y: yy - h, width: w, height: h });
          drawText("MMD Delivery", x + logoBox + 10, yy - 15, 14, true, C_TEXT);
          return;
        }

        page.drawRectangle({
          x,
          y: yy - logoBox,
          width: logoBox,
          height: logoBox,
          color: C_BRAND,
          borderColor: C_BRAND_DARK,
          borderWidth: 1,
        });
        drawText("MMD", x + 4.5, yy - 16.2, 9.5, true, rgb(1, 1, 1));
        drawText("MMD Delivery", x + logoBox + 10, yy - 15, 14, true, C_TEXT);
      };

      const drawPageHeader = (isFirst: boolean) => {
        page.drawRectangle({
          x: 0,
          y: PAGE_H,
          width: PAGE_W,
          height: HEADER_H,
          color: C_HEAD_BG,
          borderColor: C_BORDER,
          borderWidth: 1,
        });

        const top = TOP_Y;
        drawLogo(MARGIN_X, top);

        const rightX = PAGE_W - MARGIN_X - 235;
        const metaSize = 9.8;

        drawText("Driver Tax Summary", rightX, top - 2, 11.3, true, C_TEXT);
        drawText(`Year: ${year}`, rightX, top - 18, metaSize, false, C_MUTED);
        drawText(`Currency: ${currency}`, rightX, top - 31, metaSize, false, C_MUTED);
        drawText(`Report ID: ${reportId}`, rightX, top - 44, metaSize, false, C_MUTED);
        if (isFirst) {
          drawText(`Generated: ${nowIso.slice(0, 10)}`, rightX, top - 57, metaSize, false, C_MUTED);
        }

        const mode = details ? "Details" : "Compact";
        drawText(`Mode: ${mode}`, PAGE_W - MARGIN_X - 80, top - 57, 9.0, false, C_MUTED);
      };

      const drawFooter = (pageIndex: number, totalPages: number) => {
        const fy = 34;
        hr(fy + 18);
        drawText(
          "This report is generated from delivered & paid orders for the selected year.",
          MARGIN_X,
          fy + 6,
          8.6,
          false,
          C_MUTED
        );
        drawText(`MMD Delivery • ${reportId}`, MARGIN_X, fy - 7, 8.6, false, C_MUTED);
        drawTextRight(`Page ${pageIndex} / ${totalPages}`, PAGE_W - MARGIN_X, fy - 7, 8.6, false, C_MUTED);
      };

      const newPage = (isFirst: boolean) => {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        drawPageHeader(isFirst);
        y = CONTENT_TOP;
      };

      const ensureSpace = (needed = 18) => {
        if (y - needed < MIN_Y) newPage(false);
      };

      const startSectionOnNewPage = () => {
        if (y < CONTENT_TOP - 140) newPage(false);
      };

      const drawKpiCard = (
        x: number,
        yy: number,
        w: number,
        h: number,
        label: string,
        value: string
      ) => {
        rect(x, yy, w, h, rgb(0.995, 0.996, 0.998), C_BORDER);
        drawText(label, x + 12, yy - 18, 10.0, false, C_MUTED);
        drawText(value, x + 12, yy - 41, 15.0, true, C_TEXT);
      };

      drawPageHeader(true);
      y = CONTENT_TOP;

      ensureSpace(120);
      const kpiY = y;
      const kpiGap = 12;
      const cards = 3;
      const cardW = (PAGE_W - MARGIN_X * 2 - kpiGap * (cards - 1)) / cards;
      const cardH = 64;

      drawKpiCard(
        MARGIN_X + (cardW + kpiGap) * 0,
        kpiY,
        cardW,
        cardH,
        "Deliveries",
        String(totalDeliveries)
      );
      drawKpiCard(
        MARGIN_X + (cardW + kpiGap) * 1,
        kpiY,
        cardW,
        cardH,
        "Driver total",
        money(driverTotal, currency)
      );
      drawKpiCard(
        MARGIN_X + (cardW + kpiGap) * 2,
        kpiY,
        cardW,
        cardH,
        "Tips",
        money(tips, currency)
      );

      y -= cardH + 18;

      ensureSpace(130);
      drawText("Earnings breakdown", MARGIN_X, y, 13.0, true, C_TEXT);
      y -= 12;
      hr(y);
      y -= 16;

      const boxW = PAGE_W - MARGIN_X * 2;
      const boxH = 84;
      rect(MARGIN_X, y + 10, boxW, boxH, C_SURFACE, C_BORDER);

      const leftX = MARGIN_X + 14;
      const valRightX = MARGIN_X + boxW - 14;
      let iy = y - 16;

      const drawRow = (label: string, value: string) => {
        drawText(label, leftX, iy, 11.0, false, C_MUTED);
        drawTextRight(value, valRightX, iy, 11.2, true, C_TEXT);
        iy -= 20;
      };

      drawRow("Driver base payout", money(driverBasePayout, currency));
      drawRow("Tips", money(tips, currency));
      drawRow("Driver total (base + tips)", money(driverTotal, currency));

      y -= boxH + 16;

      startSectionOnNewPage();
      ensureSpace(140);

      drawText("Monthly totals", MARGIN_X, y, 13.2, true, C_TEXT);
      y -= 12;
      hr(y);
      y -= 18;

      const monthsSorted = Array.from(monthly.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      );

      if (monthsSorted.length === 0) {
        drawText("No data for this year.", MARGIN_X, y, 11.0, false, C_MUTED);
        y -= 18;
      } else {
        const tableX = MARGIN_X;
        const tableW = PAGE_W - MARGIN_X * 2;
        const tableRight = tableX + tableW;

        const colMonthX = tableX + 10;
        const colDelX = tableX + 120;
        const colDriverRight = tableRight - 10;

        page.drawRectangle({
          x: tableX,
          y: y + 8,
          width: tableW,
          height: 24,
          color: rgb(0.975, 0.976, 0.98),
          borderColor: C_BORDER,
          borderWidth: 1,
        });

        drawText("Month", colMonthX, y, 10.4, true, C_MUTED);
        drawText("Deliveries", colDelX, y, 10.4, true, C_MUTED);
        drawTextRight("Driver total", colDriverRight, y, 10.4, true, C_MUTED);

        y -= 20;

        let zebra = false;
        for (const [mk, row] of monthsSorted) {
          ensureSpace(28);

          if (zebra) {
            page.drawRectangle({
              x: tableX,
              y: y + 10,
              width: tableW,
              height: 20,
              color: rgb(0.995, 0.995, 0.997),
            });
          }
          zebra = !zebra;

          const driverMonthTotal = row.driverBase + row.tips;

          drawText(mk, colMonthX, y, 11.2, false, C_TEXT);
          drawText(String(row.deliveries), colDelX, y, 11.2, false, C_TEXT);
          drawTextRight(money(driverMonthTotal, currency), colDriverRight, y, 11.2, false, C_TEXT);

          y -= 22;
        }

        y -= 6;
      }

      startSectionOnNewPage();
      ensureSpace(110);

      drawText("Deliveries", MARGIN_X, y, 13.2, true, C_TEXT);
      drawText(details ? "(with addresses)" : "(compact)", MARGIN_X + 88, y, 10.2, false, C_MUTED);
      y -= 12;
      hr(y);
      y -= 18;

      const listX = MARGIN_X;
      const listW = PAGE_W - MARGIN_X * 2;
      const listRight = listX + listW;

      const wDate = 78;
      const wOrder = 70;
      const wTip = 70;
      const wDriver = 110;
      const colGap = 10;

      const xDate = listX + 10;
      const xOrder = xDate + wDate + colGap;
      const xRest = xOrder + wOrder + colGap;

      const rightTip = listRight - 10;
      const rightDriver = rightTip - wTip - colGap;

      const restMaxRight = rightDriver - colGap;
      const restMaxWidth = Math.max(110, restMaxRight - xRest);

      page.drawRectangle({
        x: listX,
        y: y + 8,
        width: listW,
        height: 24,
        color: rgb(0.975, 0.976, 0.98),
        borderColor: C_BORDER,
        borderWidth: 1,
      });

      drawText("Date", xDate, y, 10.4, true, C_MUTED);
      drawText("Order", xOrder, y, 10.4, true, C_MUTED);
      drawText("Restaurant", xRest, y, 10.4, true, C_MUTED);
      drawTextRight("Driver total", rightDriver, y, 10.4, true, C_MUTED);
      drawTextRight("Tip", rightTip, y, 10.4, true, C_MUTED);

      y -= 20;

      let zebra2 = false;

      for (const o of orders) {
        const effectiveDate = o.delivered_confirmed_at ?? o.created_at;
        const dateStr = isoDateYYYYMMDD(effectiveDate);
        const shortId = String(o.id ?? "").slice(0, 8) || "—";

        const restaurant =
          o.restaurant_name ||
          (o.restaurant_id ? String(o.restaurant_id).slice(0, 8) : "—");

        const tipVal = safeTipAmountUSD(o);
        const drvBase = safeNumber(o.driver_delivery_payout);
        const drvTotal = drvBase + tipVal;

        const mainSize = 11.0;
        const detailFontSize = 9.4;
        const lineH = 12.0;

        const pickupRaw = o.pickup_address || "—";
        const dropoffRaw = o.dropoff_address || "—";

        const pickupText = address === "full" ? pickupRaw : maskAddress(pickupRaw);
        const dropoffText = address === "full" ? dropoffRaw : maskAddress(dropoffRaw);

        const showDetails = details;

        let pickupLines: string[] = [];
        let dropoffLines: string[] = [];
        let blockH = 30;

        if (showDetails) {
          pickupLines = wrapTextByWidth(
            font,
            `Pickup:  ${pickupText}`,
            detailFontSize,
            restMaxWidth
          );
          dropoffLines = wrapTextByWidth(
            font,
            `Dropoff: ${dropoffText}`,
            detailFontSize,
            restMaxWidth
          );

          const headerRowH = 16;
          blockH = headerRowH + (pickupLines.length + dropoffLines.length) * lineH + 10;
        } else {
          blockH = 30;
        }

        ensureSpace(blockH + 10);

        if (zebra2) {
          page.drawRectangle({
            x: listX,
            y: y + 10,
            width: listW,
            height: blockH,
            color: rgb(0.995, 0.995, 0.997),
          });
        }
        zebra2 = !zebra2;

        drawText(dateStr, xDate, y, mainSize, false, C_TEXT);
        drawText(shortId, xOrder, y, mainSize, true, C_TEXT);
        drawText(
          fitTextToWidth(font, restaurant, mainSize, restMaxWidth),
          xRest,
          y,
          mainSize,
          false,
          C_TEXT
        );
        drawTextRight(money(drvTotal, currency), rightDriver, y, mainSize, false, C_TEXT);
        drawTextRight(money(tipVal, currency), rightTip, y, mainSize, false, C_TEXT);

        y -= 16;

        if (showDetails) {
          for (const ln of pickupLines) {
            drawText(ln, xRest, y, detailFontSize, false, C_MUTED);
            y -= lineH;
          }
          for (const ln of dropoffLines) {
            drawText(ln, xRest, y, detailFontSize, false, C_MUTED);
            y -= lineH;
          }
          y -= 2;
        }

        page.drawLine({
          start: { x: listX, y: y + 6 },
          end: { x: listX + listW, y: y + 6 },
          thickness: 1,
          color: rgb(0.95, 0.95, 0.96),
        });

        y -= 6;
      }

      ensureSpace(34);
      drawText(
        "If you believe any information is incorrect, please contact support with your Report ID.",
        MARGIN_X,
        y,
        9.2,
        false,
        C_MUTED
      );

      const pages = pdfDoc.getPages();
      for (let i = 0; i < pages.length; i++) {
        page = pages[i];
        drawFooter(i + 1, pages.length);
      }

      pdfBytes = await pdfDoc.save();
    } catch (e) {
      return jsonError(500, "Failed to generate PDF", {
        stage: "pdf.generate",
        details: errorMessage(e),
        driverId,
        year,
      });
    }

    const storagePath = `driver-tax/${driverId}/${year}/tax-summary-${year}.pdf`;

    console.log("TAX PDF DEBUG => year:", year);
    console.log("TAX PDF DEBUG => orders:", orders.length);
    console.log("TAX PDF DEBUG => pdfBytes:", pdfBytes.length);

    const uploadBody = Buffer.from(pdfBytes);

    console.log("TAX PDF DEBUG => uploadBody bytes:", uploadBody.byteLength);
    console.log("TAX PDF DEBUG => storagePath:", storagePath);
    console.log("TAX PDF DEBUG => bucket:", usedBucket);

    try {
      const uploadOptions = {
        contentType: "application/pdf",
        upsert: true,
      };

      let uploadResp = await supabaseAdmin.storage
        .from(usedBucket)
        .upload(storagePath, uploadBody, uploadOptions);

      if (uploadResp.error) {
        console.error("TAX PDF DEBUG => first upload error:", uploadResp.error);

        uploadResp = await supabaseAdmin.storage
          .from(usedBucket)
          .upload(storagePath, uploadBody, uploadOptions);
      }

      if (uploadResp.error) {
        return jsonError(500, uploadResp.error.message ?? "Storage upload failed", {
          stage: "storage.upload",
          bucket: usedBucket,
          path: storagePath,
          driverId,
          year,
          pdfBytes: uploadBody.byteLength,
          ordersCount: orders.length,
        });
      }
    } catch (e) {
      return jsonError(500, "Storage upload threw an exception", {
        stage: "storage.upload",
        details: errorMessage(e),
        bucket: usedBucket,
        path: storagePath,
        driverId,
        year,
        pdfBytes: uploadBody.byteLength,
        ordersCount: orders.length,
      });
    }

    let signedUrl = "";
    try {
      const signedResp = await supabaseAdmin.storage
        .from(usedBucket)
        .createSignedUrl(storagePath, signedUrlExpiresSeconds);

      if (signedResp.error || !signedResp.data?.signedUrl) {
        return jsonError(500, signedResp.error?.message ?? "Signed URL failed", {
          stage: "storage.createSignedUrl",
          bucket: usedBucket,
          path: storagePath,
          driverId,
          year,
        });
      }

      signedUrl = signedResp.data.signedUrl;
    } catch (e) {
      return jsonError(500, "Signed URL generation threw an exception", {
        stage: "storage.createSignedUrl",
        details: errorMessage(e),
        bucket: usedBucket,
        path: storagePath,
        driverId,
        year,
      });
    }

    try {
      const upsertResp = await supabaseAdmin.from("tax_documents").upsert(
        [
          {
            driver_id: driverId,
            year,
            storage_bucket: usedBucket,
            storage_path: storagePath,
            currency,
            total_deliveries: totalDeliveries,
            gross_delivery_fees: grossDeliveryFees,
            platform_delivery_fees: platformFees,
            driver_base_payout: driverBasePayout,
            tips,
            driver_total: driverTotal,
            generated_at: new Date().toISOString(),
          },
        ],
        { onConflict: "driver_id,year" }
      );

      if (upsertResp.error) {
        console.error("tax_documents upsert error:", upsertResp.error);
      }
    } catch (e) {
      console.error("tax_documents upsert exception:", e);
    }

    const driverTotalsSafe = {
      totalDeliveries,
      driverBasePayout: Number(driverBasePayout.toFixed(2)),
      tips: Number(tips.toFixed(2)),
      driverTotal: Number(driverTotal.toFixed(2)),
    };

    const businessTotals = {
      ordersTotal: Number(totalOrderAmount.toFixed(2)),
      subtotal: Number(subtotalAmount.toFixed(2)),
      tax: Number(taxAmount.toFixed(2)),
      grossDeliveryFees: Number(grossDeliveryFees.toFixed(2)),
      platformFees: Number(platformFees.toFixed(2)),
    };

    return NextResponse.json(
      {
        routeVersion: ROUTE_VERSION,
        year,
        driverId,
        currency,
        totals: includeBusinessTotals
          ? { ...driverTotalsSafe, ...businessTotals }
          : driverTotalsSafe,
        file: {
          bucket: usedBucket,
          path: storagePath,
          bytes: uploadBody.byteLength,
          signedUrl,
          expiresInSeconds: signedUrlExpiresSeconds,
        },
        pdfMode: {
          details,
          compact,
          address,
          includeBusinessTotals,
          hints: {
            detailsExample: `?year=${year}&details=1&address=masked`,
            fullAddressExample: `?year=${year}&details=1&address=full`,
          },
        },
        logo: {
          used: logoUsed,
          hint:
            "To use your real logo PNG, add /public/brand/mmd-logo.png (recommended) or set env MMD_LOGO_PNG_PATH.",
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return jsonError(500, errorMessage(e), {
      stage: "route.catch",
    });
  }
}