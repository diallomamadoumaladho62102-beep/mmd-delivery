/** Client-side guards for private driver-docs uploads (JPEG/PNG/PDF). */

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
]);

const MAX_BYTES = 10 * 1024 * 1024;

export function isAllowedDriverDocUpload(params: {
  byteLength: number;
  mime: string | null | undefined;
}): { ok: true } | { ok: false; reason: "empty" | "too_large" | "bad_type" } {
  const len = Number(params.byteLength);
  if (!Number.isFinite(len) || len <= 0) return { ok: false, reason: "empty" };
  if (len > MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = String(params.mime ?? "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return { ok: false, reason: "bad_type" };
  return { ok: true };
}

export const DRIVER_DOC_MAX_BYTES = MAX_BYTES;
