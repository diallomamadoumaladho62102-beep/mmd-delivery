import assert from "node:assert/strict";
import {
  rowsToCsv,
  rowsToExcelCsv,
  rowsToSimplePdf,
  exportFilename,
} from "@/lib/analytics/analyticsExport";
import {
  analyticsCacheGet,
  analyticsCacheSet,
  analyticsCacheInvalidate,
  analyticsCacheKey,
} from "@/lib/analytics/analyticsCache";
import {
  isAnalyticsModule,
  parseAnalyticsFilters,
  defaultDateRange,
} from "@/lib/analytics/analyticsTypes";

assert.equal(isAnalyticsModule("global"), true);
assert.equal(isAnalyticsModule("nope"), false);

const range = defaultDateRange();
assert.ok(range.from);
assert.ok(range.to);

const filters = parseAnalyticsFilters({
  from: "2026-01-01",
  to: "2026-01-31",
  country: "US",
});
assert.equal(filters.countryCode, "US");
assert.equal(filters.from, "2026-01-01");

const rows = [
  { label: "GMV", value: 1200 },
  { label: "Orders", value: 12 },
];
const csv = rowsToCsv(rows);
assert.ok(csv.includes("label,value"));
assert.ok(csv.includes("GMV"));

const excel = rowsToExcelCsv(rows);
assert.ok(excel.startsWith("\uFEFF"));

const pdf = rowsToSimplePdf("Test", rows);
assert.ok(pdf.byteLength > 50);
assert.ok(exportFilename("global", "csv").endsWith(".csv"));

const key = analyticsCacheKey("global", { from: "a" });
analyticsCacheSet(key, { ok: true }, 5000);
assert.deepEqual(analyticsCacheGet(key), { ok: true });
analyticsCacheInvalidate("analytics:");
assert.equal(analyticsCacheGet(key), null);

console.log("analyticsExport.test.ts: ok");
