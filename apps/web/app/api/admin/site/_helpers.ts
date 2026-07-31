import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { AdminAccessError } from "@/lib/adminServer";
import { SITE_CMS_TAG, type SitePublishStatus } from "@/lib/siteCms";

export function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

export function cleanInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function cleanBool(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

export function cleanDate(value: unknown): string | null {
  const t = cleanText(value, 40);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function cleanStatus(value: unknown): SitePublishStatus | null {
  const t = cleanText(value, 32);
  if (
    t === "draft" ||
    t === "scheduled" ||
    t === "published" ||
    t === "archived"
  ) {
    return t;
  }
  return null;
}

export function cleanStringArray(
  value: unknown,
  maxItems = 40,
  maxLen = 80,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => cleanText(v, maxLen))
    .filter((v): v is string => Boolean(v))
    .slice(0, maxItems);
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function revalidateSiteCms() {
  revalidateTag(SITE_CMS_TAG, "max");
}

/** Call after writes that publish or affect live public content. */
export function revalidateIfPublished(status: unknown) {
  if (status === "published") revalidateSiteCms();
}

export function adminError(e: unknown) {
  const status = e instanceof AdminAccessError ? e.status : 500;
  return json(
    { ok: false, error: e instanceof Error ? e.message : "Server error" },
    status,
  );
}
