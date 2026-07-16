/**
 * Shared upload validation — MIME allowlists, magic-byte sniffing,
 * size limits, and safe storage path segments.
 */

export const LOCATION_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const SAFETY_RECORDING_MAX_BYTES = 100 * 1024 * 1024;
export const IDENTITY_SELFIE_MAX_BYTES = 8 * 1024 * 1024;

export const LOCATION_PHOTO_MIME_ALLOWLIST = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

export const SAFETY_RECORDING_MIME_ALLOWLIST = [
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "video/mp4",
  "video/quicktime",
] as const;

export const IDENTITY_SELFIE_MIME_ALLOWLIST = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

export const IDENTITY_SELFIE_EXT_ALLOWLIST = ["jpg", "jpeg", "png", "webp"] as const;

type MagicRule = {
  mime: string;
  ext: string;
  bytes: number[];
  offset?: number;
};

const IMAGE_MAGIC: MagicRule[] = [
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF….WEBP checked below
];

function matchesMagic(buffer: Buffer, rule: MagicRule): boolean {
  const offset = rule.offset ?? 0;
  if (buffer.length < offset + rule.bytes.length) return false;
  for (let i = 0; i < rule.bytes.length; i += 1) {
    if (buffer[offset + i] !== rule.bytes[i]) return false;
  }
  if (rule.mime === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }
  return true;
}

export function sniffImageMime(buffer: Buffer): { mime: string; ext: string } | null {
  for (const rule of IMAGE_MAGIC) {
    if (matchesMagic(buffer, rule)) {
      return { mime: rule.mime, ext: rule.ext };
    }
  }
  return null;
}

export function normalizeMime(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    .trim();
}

export function isAllowedMime(
  mime: string,
  allowlist: readonly string[]
): boolean {
  const normalized = normalizeMime(mime);
  if (!normalized) return false;
  if (normalized === "image/jpg") {
    return allowlist.includes("image/jpeg") || allowlist.includes("image/jpg");
  }
  return allowlist.includes(normalized);
}

export function assertByteSize(
  size: number,
  maxBytes: number,
  label = "file"
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: `${label}_size_invalid` };
  }
  if (size > maxBytes) {
    return { ok: false, error: `${label}_too_large` };
  }
  return { ok: true };
}

/** Reject path traversal / absolute / empty segments. */
export function isSafeStoragePathSegment(segment: string): boolean {
  const value = String(segment ?? "").trim();
  if (!value) return false;
  if (value.includes("..") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (value.startsWith("/") || value.includes("//")) return false;
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function sanitizeStorageExtension(
  raw: string,
  allowlist: readonly string[],
  fallback: string
): string {
  const ext = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "")
    .replace(/[^a-z0-9]/g, "");
  if (allowlist.includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return fallback;
}

export function resolveLocationPhotoContent(params: {
  claimedMime?: string | null;
  buffer: Buffer;
}):
  | { ok: true; mime: string; ext: string }
  | { ok: false; error: string } {
  const sizeCheck = assertByteSize(
    params.buffer.length,
    LOCATION_PHOTO_MAX_BYTES,
    "image"
  );
  if (sizeCheck.ok === false) return sizeCheck;

  const sniffed = sniffImageMime(params.buffer);
  if (!sniffed) {
    return { ok: false, error: "image_magic_bytes_invalid" };
  }

  const claimed = normalizeMime(params.claimedMime);
  if (
    claimed &&
    claimed !== "image/jpg" &&
    claimed !== sniffed.mime &&
    !(claimed === "image/jpeg" && sniffed.mime === "image/jpeg")
  ) {
    // Allow jpeg/jpg alias mismatch only.
    if (
      !(
        (claimed === "image/jpeg" || claimed === "image/jpg") &&
        sniffed.mime === "image/jpeg"
      )
    ) {
      return { ok: false, error: "image_mime_mismatch" };
    }
  }

  if (!isAllowedMime(sniffed.mime, LOCATION_PHOTO_MIME_ALLOWLIST)) {
    return { ok: false, error: "image_mime_not_allowed" };
  }

  return { ok: true, mime: sniffed.mime, ext: sniffed.ext };
}

export function resolveSafetyRecordingUpload(params: {
  rideId: string;
  recordingId: string;
  clientPath?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  fileSizeBytes?: number | null;
}):
  | { ok: true; storagePath: string; mimeType: string; fileSizeBytes: number }
  | { ok: false; error: string } {
  const mime = normalizeMime(params.mimeType) || "audio/mp4";
  if (!isAllowedMime(mime, SAFETY_RECORDING_MIME_ALLOWLIST)) {
    return { ok: false, error: "mime_not_allowed" };
  }

  const size = Number(params.fileSizeBytes ?? 0);
  const sizeCheck = assertByteSize(size, SAFETY_RECORDING_MAX_BYTES, "recording");
  if (sizeCheck.ok === false) return sizeCheck;

  const ext = sanitizeStorageExtension(
    params.extension ??
      (mime.includes("quicktime")
        ? "mov"
        : mime.includes("mpeg")
          ? "mp3"
          : mime.includes("aac")
            ? "aac"
            : mime.startsWith("video/")
              ? "mp4"
              : "m4a"),
    ["m4a", "mp4", "aac", "mp3", "mov"],
    "m4a"
  );

  if (
    !isSafeStoragePathSegment(params.rideId) ||
    !isSafeStoragePathSegment(params.recordingId)
  ) {
    return { ok: false, error: "invalid_recording_path_ids" };
  }

  // Always server-build the path. If client sent a path, it must match prefix.
  const expectedPrefix = `${params.rideId}/${params.recordingId}/`;
  const clientPath = String(params.clientPath ?? "").trim();
  if (clientPath) {
    if (
      clientPath.includes("..") ||
      clientPath.includes("\\") ||
      clientPath.startsWith("/") ||
      !clientPath.startsWith(expectedPrefix)
    ) {
      return { ok: false, error: "invalid_storage_path" };
    }
  }

  const storagePath = `${expectedPrefix}${Date.now()}.${ext}`;
  return { ok: true, storagePath, mimeType: mime === "image/jpg" ? "image/jpeg" : mime, fileSizeBytes: size };
}

export function validateIdentitySelfiePath(params: {
  userId: string;
  path: string;
  allowedExts?: readonly string[];
}): { ok: true } | { ok: false; error: string } {
  const path = String(params.path ?? "").trim();
  const prefix = `drivers/${params.userId}/`;
  if (!path.startsWith(prefix)) {
    return { ok: false, error: "invalid_path" };
  }
  if (path.includes("..") || path.includes("\\") || path.includes("//")) {
    return { ok: false, error: "invalid_path" };
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const allow = params.allowedExts ?? IDENTITY_SELFIE_EXT_ALLOWLIST;
  if (!allow.includes(ext as (typeof IDENTITY_SELFIE_EXT_ALLOWLIST)[number])) {
    return { ok: false, error: "invalid_extension" };
  }
  return { ok: true };
}
