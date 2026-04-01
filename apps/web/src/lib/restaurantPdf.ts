import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
import type { RestaurantTaxSummary } from "./restaurantTax";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(date);
}

async function loadLogoPngBytes(): Promise<Uint8Array | null> {
  const cwd = process.cwd();

  const candidates = [
    path.join(cwd, "apps", "web", "public", "brand", "mmd-logo.png"),
    path.join(cwd, "public", "brand", "mmd-logo.png"),
    path.join(cwd, "apps", "web", "public", "mmd-logo.png"),
    path.join(cwd, "public", "mmd-logo.png"),
  ];

  for (const filePath of candidates) {
    try {
      const buf = await fs.readFile(filePath);
      if (buf?.byteLength) {
        return new Uint8Array(buf);
      }
    } catch {
      // continue silently
    }
  }

  return null;
}

type DrawContext = {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  width: number;
  height: number;
  marginX: number;
  y: number;
};

function drawTextLine(
  ctx: DrawContext,
  text: string,
  options?: {
    x?: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    lineGap?: number;
  }
) {
  const x = options?.x ?? ctx.marginX;
  const size = options?.size ?? 12;
  const selectedFont = options?.bold ? ctx.bold : ctx.font;
  const color = options?.color ?? rgb(0.12, 0.12, 0.12);

  ctx.page.drawText(text, {
    x,
    y: ctx.y,
    size,
    font: selectedFont,
    color,
  });

  ctx.y -= size + (options?.lineGap ?? 6);
}

function drawDivider(ctx: DrawContext, color = rgb(0.88, 0.88, 0.9)) {
  ctx.page.drawLine({
    start: { x: ctx.marginX, y: ctx.y },
    end: { x: ctx.width - ctx.marginX, y: ctx.y },
    thickness: 1,
    color,
  });

  ctx.y -= 16;
}

function drawSectionTitle(ctx: DrawContext, title: string) {
  drawTextLine(ctx, title, {
    size: 14,
    bold: true,
    color: rgb(0.08, 0.08, 0.08),
    lineGap: 8,
  });
}

function drawLabelValue(
  ctx: DrawContext,
  label: string,
  value: string,
  options?: { valueX?: number }
) {
  const labelX = ctx.marginX;
  const valueX = options?.valueX ?? 220;

  ctx.page.drawText(label, {
    x: labelX,
    y: ctx.y,
    size: 11,
    font: ctx.font,
    color: rgb(0.4, 0.4, 0.45),
  });

  ctx.page.drawText(value, {
    x: valueX,
    y: ctx.y,
    size: 11,
    font: ctx.bold,
    color: rgb(0.12, 0.12, 0.12),
  });

  ctx.y -= 18;
}

function drawSummaryCard(
  ctx: DrawContext,
  title: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.86, 0.88, 0.9),
    borderWidth: 1,
  });

  ctx.page.drawText(title, {
    x: x + 14,
    y: y + height - 22,
    size: 10,
    font: ctx.font,
    color: rgb(0.4, 0.4, 0.45),
  });

  ctx.page.drawText(value, {
    x: x + 14,
    y: y + height - 44,
    size: 16,
    font: ctx.bold,
    color: rgb(0.08, 0.08, 0.08),
  });
}

export async function buildRestaurantTaxPdf(
  summary: RestaurantTaxSummary
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);

  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = await loadLogoPngBytes();
  const logoImage = logoBytes ? await pdf.embedPng(logoBytes) : null;

  const ctx: DrawContext = {
    page,
    font,
    bold,
    width,
    height,
    marginX: 48,
    y: height - 56,
  };

  // Background frame
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 56,
    borderWidth: 1,
    borderColor: rgb(0.88, 0.88, 0.9),
  });

  // Header with logo
  if (logoImage) {
    const maxLogoWidth = 42;
    const maxLogoHeight = 42;
    const scale = Math.min(
      maxLogoWidth / logoImage.width,
      maxLogoHeight / logoImage.height
    );

    const logoWidth = logoImage.width * scale;
    const logoHeight = logoImage.height * scale;

    page.drawImage(logoImage, {
      x: ctx.marginX,
      y: height - 58 - logoHeight + 6,
      width: logoWidth,
      height: logoHeight,
    });

    drawTextLine(ctx, "MMD Delivery", {
      x: ctx.marginX + logoWidth + 12,
      size: 22,
      bold: true,
      color: rgb(0.06, 0.06, 0.08),
      lineGap: 2,
    });

    drawTextLine(ctx, "Restaurant Tax Summary", {
      x: ctx.marginX + logoWidth + 12,
      size: 18,
      bold: true,
      color: rgb(0.12, 0.12, 0.12),
      lineGap: 4,
    });

    drawTextLine(
      ctx,
      `Reporting year ${summary.year} • Generated ${formatDate(summary.generatedAt)}`,
      {
        x: ctx.marginX + logoWidth + 12,
        size: 10,
        color: rgb(0.45, 0.45, 0.48),
        lineGap: 12,
      }
    );
  } else {
    drawTextLine(ctx, "MMD Delivery", {
      size: 22,
      bold: true,
      color: rgb(0.06, 0.06, 0.08),
      lineGap: 2,
    });

    drawTextLine(ctx, "Restaurant Tax Summary", {
      size: 18,
      bold: true,
      color: rgb(0.12, 0.12, 0.12),
      lineGap: 4,
    });

    drawTextLine(
      ctx,
      `Reporting year ${summary.year} • Generated ${formatDate(summary.generatedAt)}`,
      {
        size: 10,
        color: rgb(0.45, 0.45, 0.48),
        lineGap: 12,
      }
    );
  }

  drawDivider(ctx);

  // Summary cards
  const cardsTopY = ctx.y - 92;
  const gap = 12;
  const cardWidth = (width - ctx.marginX * 2 - gap) / 2;
  const cardHeight = 66;

  drawSummaryCard(
    ctx,
    "Gross sales",
    money(summary.totals.grossSales),
    ctx.marginX,
    cardsTopY,
    cardWidth,
    cardHeight
  );

  drawSummaryCard(
    ctx,
    "Platform commission (15%)",
    money(summary.totals.platformCommission),
    ctx.marginX + cardWidth + gap,
    cardsTopY,
    cardWidth,
    cardHeight
  );

  const secondRowY = cardsTopY - cardHeight - 12;

  drawSummaryCard(
    ctx,
    "Restaurant net",
    money(summary.totals.restaurantNet),
    ctx.marginX,
    secondRowY,
    cardWidth,
    cardHeight
  );

  drawSummaryCard(
    ctx,
    "Included orders",
    String(summary.totals.totalOrders),
    ctx.marginX + cardWidth + gap,
    secondRowY,
    cardWidth,
    cardHeight
  );

  ctx.y = secondRowY - 28;

  drawDivider(ctx);

  // Restaurant information
  drawSectionTitle(ctx, "Restaurant information");

  drawLabelValue(
    ctx,
    "Restaurant name",
    summary.profile.restaurantName ?? "—"
  );
  drawLabelValue(ctx, "Email", summary.profile.email ?? "—");
  drawLabelValue(ctx, "Tax ID / EIN", summary.profile.taxId ?? "—");
  drawLabelValue(ctx, "Phone", summary.profile.phone ?? "—");

  const address =
    [
      summary.profile.address,
      summary.profile.city,
      summary.profile.postalCode,
    ]
      .filter(Boolean)
      .join(", ") || "—";

  drawLabelValue(ctx, "Business address", address);

  ctx.y -= 6;
  drawDivider(ctx);

  // Tax profile status
  drawSectionTitle(ctx, "Tax profile status");

  drawLabelValue(
    ctx,
    "Profile completeness",
    summary.profile.isComplete ? "Complete" : "Incomplete"
  );

  drawLabelValue(
    ctx,
    "Missing fields",
    summary.profile.missingFields.length > 0
      ? summary.profile.missingFields.join(", ")
      : "None"
  );

  ctx.y -= 6;
  drawDivider(ctx);

  // Notes
  drawSectionTitle(ctx, "Notes");

  drawTextLine(
    ctx,
    "This document was generated by MMD Delivery for restaurant reporting and tax preparation support.",
    {
      size: 10,
      color: rgb(0.28, 0.28, 0.32),
      lineGap: 4,
    }
  );

  drawTextLine(
    ctx,
    "Amounts reflect your restaurant totals for the selected year using the platform commission model configured in MMD Delivery.",
    {
      size: 10,
      color: rgb(0.28, 0.28, 0.32),
      lineGap: 4,
    }
  );

  drawTextLine(
    ctx,
    "Please verify your restaurant profile, tax ID / EIN, and business information before using this summary for accounting or filing.",
    {
      size: 10,
      color: rgb(0.28, 0.28, 0.32),
      lineGap: 4,
    }
  );

  // Footer
  page.drawLine({
    start: { x: ctx.marginX, y: 56 },
    end: { x: width - ctx.marginX, y: 56 },
    thickness: 1,
    color: rgb(0.9, 0.9, 0.92),
  });

  page.drawText("MMD Delivery • Restaurant Tax Summary", {
    x: ctx.marginX,
    y: 40,
    size: 9,
    font,
    color: rgb(0.5, 0.5, 0.54),
  });

  page.drawText(`Year ${summary.year}`, {
    x: width - ctx.marginX - 46,
    y: 40,
    size: 9,
    font: bold,
    color: rgb(0.35, 0.35, 0.4),
  });

  return pdf.save();
}