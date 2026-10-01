import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDaysInZone,
  isValidTimeZone,
  parseAdminDateTime,
  utcIsoToDatetimeLocal,
  zonedLocalToUtcMs,
  zonedParts,
} from "./zonedTime";

test("invalid timezone is rejected", () => {
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Europe/Paris"), true);
});

test("Admin wall clock uses engine timezone not the browser", () => {
  const parsed = parseAdminDateTime("2026-10-05T09:00", "America/New_York");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.iso, "2026-10-05T13:00:00.000Z");
    assert.equal(utcIsoToDatetimeLocal(parsed.iso ?? "", "America/New_York"), "2026-10-05T09:00");
  }
});

test("Admin datetime in another configured timezone", () => {
  const parsed = parseAdminDateTime("2026-10-05T09:00", "Europe/Paris");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.iso, "2026-10-05T07:00:00.000Z");
  }
});

test("explicit offset is accepted without reinterpretation", () => {
  const parsed = parseAdminDateTime("2026-10-05T13:00:00.000Z", "Europe/Paris");
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.iso, "2026-10-05T13:00:00.000Z");
});

test("empty Admin datetime clears the value", () => {
  const parsed = parseAdminDateTime("", "America/New_York");
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.iso, null);
});

test("invalid datetime and missing timezone are rejected", () => {
  assert.equal(parseAdminDateTime("2026-13-40T99:99", "America/New_York").ok, false);
  assert.equal(parseAdminDateTime("2026-10-05T09:00", null).ok, false);
  assert.equal(parseAdminDateTime("2026-10-05T09:00", "Not/AZone").ok, false);
});

test("nonexistent spring-forward local time is rejected", () => {
  const parsed = parseAdminDateTime("2026-03-08T02:30", "America/New_York");
  assert.equal(parsed.ok, false);
});

test("DST spring week is seven local days not 7×24h UTC", () => {
  const start = zonedLocalToUtcMs(2026, 3, 2, 0, 0, 0, "America/New_York");
  const end = Date.parse(
    addCalendarDaysInZone(new Date(start).toISOString(), 7, "America/New_York") ?? ""
  );
  assert.equal(zonedParts(start, "America/New_York").hour, 0);
  assert.equal(zonedParts(end, "America/New_York").hour, 0);
  assert.equal(end - start, 167 * 3600_000);
});

test("DST fall week is seven local days not 7×24h UTC", () => {
  const start = zonedLocalToUtcMs(2026, 10, 26, 0, 0, 0, "America/New_York");
  const end = Date.parse(
    addCalendarDaysInZone(new Date(start).toISOString(), 7, "America/New_York") ?? ""
  );
  assert.equal(end - start, 169 * 3600_000);
});
