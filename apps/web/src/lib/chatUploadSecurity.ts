import {
  IDENTITY_SELFIE_EXT_ALLOWLIST,
  IDENTITY_SELFIE_MAX_BYTES,
  IDENTITY_SELFIE_MIME_ALLOWLIST,
  normalizeMime,
  sniffImageMime,
} from "./uploadSecurity";

export const CHAT_IMAGE_BUCKET = "chat-images";
export const CHAT_IMAGE_MAX_BYTES = IDENTITY_SELFIE_MAX_BYTES;
export const CHAT_IMAGE_MIME_ALLOWLIST = IDENTITY_SELFIE_MIME_ALLOWLIST;
export const CHAT_IMAGE_EXT_ALLOWLIST = IDENTITY_SELFIE_EXT_ALLOWLIST;

export function validateChatImageFile(file: File): void {
  if (!file) throw new Error("Missing image file");
  if (file.size <= 0) throw new Error("Empty image file");
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error(`Image too large (max ${CHAT_IMAGE_MAX_BYTES / (1024 * 1024)} MB)`);
  }

  const mime = normalizeMime(file.type);
  if (
    !CHAT_IMAGE_MIME_ALLOWLIST.includes(
      mime as (typeof CHAT_IMAGE_MIME_ALLOWLIST)[number],
    )
  ) {
    throw new Error("Unsupported image type");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    ext &&
    !CHAT_IMAGE_EXT_ALLOWLIST.includes(
      ext as (typeof CHAT_IMAGE_EXT_ALLOWLIST)[number],
    )
  ) {
    throw new Error("Unsupported image extension");
  }
}

export async function validateChatImageBuffer(buffer: Buffer): Promise<{
  mime: string;
  ext: string;
}> {
  if (buffer.length <= 0) throw new Error("Empty image file");
  if (buffer.length > CHAT_IMAGE_MAX_BYTES) {
    throw new Error(`Image too large (max ${CHAT_IMAGE_MAX_BYTES / (1024 * 1024)} MB)`);
  }

  const sniffed = sniffImageMime(buffer);
  if (!sniffed) throw new Error("Unsupported image content");

  return sniffed;
}

export function buildChatImageStoragePath(orderId: string, ext: string): string {
  const safeExt = String(ext || "jpg")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${orderId}/${suffix}.${safeExt || "jpg"}`;
}

export function toChatImagePath(storageKey: string): string {
  const key = String(storageKey ?? "").trim().replace(/^chat-images\//, "");
  return `chat-images/${key}`;
}
