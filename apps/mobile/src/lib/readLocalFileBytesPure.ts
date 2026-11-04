/**
 * Pure guards for local file reads (no Expo / RN imports — unit-testable on Node).
 */

export type ReadLocalFileBytesErrorReason =
  | "missing_uri"
  | "not_found"
  | "empty"
  | "too_large"
  | "bad_mime"
  | "cancelled"
  | "read_failed";

export class ReadLocalFileBytesError extends Error {
  readonly reason: ReadLocalFileBytesErrorReason;

  constructor(reason: ReadLocalFileBytesErrorReason, message: string) {
    super(message);
    this.name = "ReadLocalFileBytesError";
    this.reason = reason;
  }
}

export const DEFAULT_LOCAL_FILE_MAX_BYTES = 10 * 1024 * 1024;

export function normalizeMime(mime: string | null | undefined): string | null {
  const m = String(mime ?? "")
    .trim()
    .toLowerCase();
  return m || null;
}

export function evaluateLocalFileReadGuard(params: {
  uri: string;
  exists: boolean;
  byteLength: number;
  maxBytes?: number;
  mime?: string | null;
  allowedMimes?: ReadonlySet<string> | readonly string[];
}): { ok: true; mime: string | null } | { ok: false; reason: ReadLocalFileBytesErrorReason } {
  if (!String(params.uri ?? "").trim()) return { ok: false, reason: "missing_uri" };
  if (!params.exists) return { ok: false, reason: "not_found" };
  const len = Number(params.byteLength);
  if (!Number.isFinite(len) || len <= 0) return { ok: false, reason: "empty" };
  const max = params.maxBytes ?? DEFAULT_LOCAL_FILE_MAX_BYTES;
  if (len > max) return { ok: false, reason: "too_large" };
  const mime = normalizeMime(params.mime);
  if (params.allowedMimes) {
    const allowed =
      params.allowedMimes instanceof Set
        ? params.allowedMimes
        : new Set(
            [...params.allowedMimes].map((m) => String(m).trim().toLowerCase()).filter(Boolean),
          );
    if (!mime || !allowed.has(mime)) return { ok: false, reason: "bad_mime" };
  }
  return { ok: true, mime };
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = (base64 || "").replace(/\s/g, "");
  const atobSafe =
    typeof globalThis.atob === "function"
      ? globalThis.atob.bind(globalThis)
      : (b64: string) => {
          const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
          let str = "";
          let i = 0;
          while (i < b64.length) {
            const enc1 = chars.indexOf(b64.charAt(i++));
            const enc2 = chars.indexOf(b64.charAt(i++));
            const enc3 = chars.indexOf(b64.charAt(i++));
            const enc4 = chars.indexOf(b64.charAt(i++));
            const chr1 = (enc1 << 2) | (enc2 >> 4);
            const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            const chr3 = ((enc3 & 3) << 6) | enc4;
            str += String.fromCharCode(chr1);
            if (enc3 !== 64) str += String.fromCharCode(chr2);
            if (enc4 !== 64) str += String.fromCharCode(chr3);
          }
          return str;
        };

  const binary = atobSafe(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
