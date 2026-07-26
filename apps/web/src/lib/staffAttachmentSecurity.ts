/**
 * Staff attachment validation — MIME allowlist, size limits, safe paths.
 * Bucket `staff-attachments` is private; serve only via short-lived signed URLs.
 */

import {
  assertByteSize,
  isAllowedMime,
  isSafeStoragePathSegment,
  normalizeMime,
  sniffImageMime,
} from "@/lib/uploadSecurity";

function safeSegment(raw: string, fallback = "x"): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return isSafeStoragePathSegment(cleaned) ? cleaned : fallback;
}

export const STAFF_ATTACHMENTS_BUCKET = "staff-attachments";

export const STAFF_ATTACHMENT_MAX_BYTES = {
  image: 8 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 20 * 1024 * 1024,
} as const;

export const STAFF_IMAGE_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

export const STAFF_AUDIO_MIME = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
] as const;

export const STAFF_VIDEO_MIME = [
  "video/webm",
  "video/mp4",
  "video/quicktime",
] as const;

export const STAFF_DOCUMENT_MIME = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type StaffAttachmentKind = "image" | "audio" | "video" | "document";

export function resolveStaffAttachmentKind(
  mimeRaw: string
): StaffAttachmentKind | null {
  const mime = normalizeMime(mimeRaw);
  if (isAllowedMime(mime, STAFF_IMAGE_MIME)) return "image";
  if (isAllowedMime(mime, STAFF_AUDIO_MIME)) return "audio";
  if (isAllowedMime(mime, STAFF_VIDEO_MIME)) return "video";
  if (isAllowedMime(mime, STAFF_DOCUMENT_MIME)) return "document";
  return null;
}

export function messageTypeForKind(kind: StaffAttachmentKind): string {
  if (kind === "image") return "image";
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "file";
}

export function validateStaffAttachmentMeta(input: {
  mime: string;
  size: number;
  fileName?: string;
}):
  | { ok: true; kind: StaffAttachmentKind; mime: string; safeName: string }
  | { ok: false; error: string } {
  const mime = normalizeMime(input.mime);
  const kind = resolveStaffAttachmentKind(mime);
  if (!kind) {
    return { ok: false, error: "Unsupported MIME type" };
  }
  const sizeCheck = assertByteSize(
    input.size,
    STAFF_ATTACHMENT_MAX_BYTES[kind],
    kind
  );
  if (sizeCheck.ok === false) return { ok: false, error: sizeCheck.error };

  const rawName = String(input.fileName ?? "upload").trim() || "upload";
  const ext = rawName.includes(".")
    ? rawName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
    : kind === "image"
      ? "jpg"
      : kind === "audio"
        ? "webm"
        : kind === "video"
          ? "mp4"
          : "bin";
  const base = safeSegment(rawName.replace(/\.[^.]+$/, ""), "file");
  const safeName = `${base}.${ext || "bin"}`.slice(0, 120);

  return { ok: true, kind, mime, safeName };
}

export async function validateStaffAttachmentBuffer(input: {
  buffer: Buffer;
  mime: string;
  kind: StaffAttachmentKind;
}): Promise<{ ok: true; mime: string } | { ok: false; error: string }> {
  const { buffer, kind } = input;
  if (buffer.length <= 0) return { ok: false, error: "Empty file" };
  if (buffer.length > STAFF_ATTACHMENT_MAX_BYTES[kind]) {
    return {
      ok: false,
      error: `File too large (max ${STAFF_ATTACHMENT_MAX_BYTES[kind]} bytes)`,
    };
  }
  if (kind === "image") {
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) return { ok: false, error: "Invalid image content" };
    return { ok: true, mime: sniffed.mime };
  }
  // Audio/video/docs: trust allowlisted declared MIME after size check;
  // magic sniffing for containers is inconsistent across browsers (webm/ogg).
  return { ok: true, mime: normalizeMime(input.mime) };
}

export function buildStaffAttachmentPath(input: {
  conversationId: string;
  uploaderId: string;
  safeName: string;
}): string {
  const conversationId = safeSegment(input.conversationId, "unknown");
  const uploaderId = safeSegment(input.uploaderId, "unknown");
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${conversationId}/${uploaderId}/${stamp}_${input.safeName}`;
}

export const STAFF_SIGNED_URL_TTL_SECONDS = 60 * 15; // 15 minutes
