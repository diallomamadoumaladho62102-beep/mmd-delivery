export type ExportFormat = "csv" | "excel" | "pdf" | "json";

function escapeCsv(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function rowsToCsv(
  rows: Array<Record<string, unknown>>,
  columns?: string[]
): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const header = cols.map(escapeCsv).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCsv(row[c])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Excel-friendly CSV (UTF-8 BOM). No extra dependency. */
export function rowsToExcelCsv(
  rows: Array<Record<string, unknown>>,
  columns?: string[]
): string {
  return `\uFEFF${rowsToCsv(rows, columns)}`;
}

/** Minimal single-page PDF with plain text lines (no external deps). */
export function rowsToSimplePdf(
  title: string,
  rows: Array<Record<string, unknown>>,
  columns?: string[]
): Uint8Array {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [
    title,
    `Generated: ${new Date().toISOString()}`,
    "",
    cols.join(" | "),
    "-".repeat(60),
    ...rows.slice(0, 80).map((row) =>
      cols.map((c) => String(row[c] ?? "")).join(" | ")
    ),
  ];

  const contentLines = lines.map((line, i) => {
    const y = 800 - i * 14;
    const safe = line.replace(/[()\\]/g, " ");
    return `BT /F1 10 Tf 40 ${y} Td (${safe.slice(0, 110)}) Tj ET`;
  });

  const stream = contentLines.join("\n");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function exportContentType(format: ExportFormat): string {
  if (format === "pdf") return "application/pdf";
  if (format === "excel") return "application/vnd.ms-excel";
  if (format === "json") return "application/json; charset=utf-8";
  return "text/csv; charset=utf-8";
}

export function exportFilename(
  module: string,
  format: ExportFormat
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "pdf") return `mmd-analytics-${module}-${stamp}.pdf`;
  if (format === "excel") return `mmd-analytics-${module}-${stamp}.xls`;
  if (format === "json") return `mmd-analytics-${module}-${stamp}.json`;
  return `mmd-analytics-${module}-${stamp}.csv`;
}
