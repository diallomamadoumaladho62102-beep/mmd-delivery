/**
 * Safe local-file byte reads for React Native / Expo.
 *
 * Avoids network-style local URI reads that route through RCTFileReaderModule
 * (native EXC_BAD_ACCESS under memory pressure on iOS — Sentry MMD-DELIVERY-MOBILE-G).
 *
 * Always uses expo-file-system after size / MIME guards.
 */
import * as FileSystem from "expo-file-system/legacy";
import {
  base64ToUint8Array,
  DEFAULT_LOCAL_FILE_MAX_BYTES,
  evaluateLocalFileReadGuard,
  normalizeMime,
  ReadLocalFileBytesError,
  type ReadLocalFileBytesErrorReason,
} from "./readLocalFileBytesPure";

export {
  DEFAULT_LOCAL_FILE_MAX_BYTES,
  evaluateLocalFileReadGuard,
  normalizeMime,
  ReadLocalFileBytesError,
  type ReadLocalFileBytesErrorReason,
} from "./readLocalFileBytesPure";

export type ReadLocalFileBytesParams = {
  uri: string;
  maxBytes?: number;
  allowedMimes?: ReadonlySet<string> | readonly string[];
  mime?: string | null;
  signal?: AbortSignal;
};

export type ReadLocalFileBytesResult = {
  bytes: Uint8Array;
  byteLength: number;
  mime: string | null;
};

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ReadLocalFileBytesError("cancelled", "Local file read was cancelled.");
  }
}

export async function readLocalFileBytes(
  params: ReadLocalFileBytesParams,
): Promise<ReadLocalFileBytesResult> {
  const uri = String(params.uri ?? "").trim();
  const maxBytes = params.maxBytes ?? DEFAULT_LOCAL_FILE_MAX_BYTES;
  const mimeHint = normalizeMime(params.mime);

  assertNotCancelled(params.signal);

  const guardUri = evaluateLocalFileReadGuard({
    uri,
    exists: true,
    byteLength: 1,
    maxBytes,
    mime: mimeHint,
    allowedMimes: params.allowedMimes,
  });
  if (guardUri.ok === false && guardUri.reason === "missing_uri") {
    throw new ReadLocalFileBytesError("missing_uri", "Local file URI is required.");
  }
  if (guardUri.ok === false && guardUri.reason === "bad_mime") {
    throw new ReadLocalFileBytesError(
      "bad_mime",
      `MIME type not allowed: ${mimeHint ?? "(none)"}`,
    );
  }

  let info: { exists: boolean; size?: number };
  try {
    info = (await FileSystem.getInfoAsync(uri)) as { exists: boolean; size?: number };
  } catch (e: unknown) {
    throw new ReadLocalFileBytesError(
      "read_failed",
      `Unable to stat local file: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  assertNotCancelled(params.signal);

  const pre = evaluateLocalFileReadGuard({
    uri,
    exists: Boolean(info.exists),
    byteLength: Number(info.size ?? 0),
    maxBytes,
    mime: mimeHint,
    allowedMimes: params.allowedMimes,
  });
  if (pre.ok === false) {
    const messages: Record<ReadLocalFileBytesErrorReason, string> = {
      missing_uri: "Local file URI is required.",
      not_found: "Local file not found on device.",
      empty: "Local file is empty.",
      too_large: `Local file exceeds max size (${maxBytes} bytes).`,
      bad_mime: `MIME type not allowed: ${mimeHint ?? "(none)"}`,
      cancelled: "Local file read was cancelled.",
      read_failed: "Local file read failed.",
    };
    throw new ReadLocalFileBytesError(pre.reason, messages[pre.reason]);
  }

  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e: unknown) {
    assertNotCancelled(params.signal);
    throw new ReadLocalFileBytesError(
      "read_failed",
      `Unable to read local file bytes: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  assertNotCancelled(params.signal);

  if (!base64 || base64.length < 1) {
    throw new ReadLocalFileBytesError("empty", "Local file read returned empty content.");
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(base64);
  } catch (e: unknown) {
    throw new ReadLocalFileBytesError(
      "read_failed",
      `Base64 decode failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const post = evaluateLocalFileReadGuard({
    uri,
    exists: true,
    byteLength: bytes.byteLength,
    maxBytes,
    mime: mimeHint,
    allowedMimes: params.allowedMimes,
  });
  if (post.ok === false) {
    throw new ReadLocalFileBytesError(post.reason, `Post-read guard failed: ${post.reason}`);
  }

  return {
    bytes,
    byteLength: bytes.byteLength,
    mime: mimeHint,
  };
}

/** Size-only helper that never uses FileReader / blob network reads. */
export async function getLocalFileByteLength(
  uri: string,
  signal?: AbortSignal,
): Promise<number> {
  assertNotCancelled(signal);
  const info = (await FileSystem.getInfoAsync(uri)) as { exists: boolean; size?: number };
  assertNotCancelled(signal);
  if (!info.exists) {
    throw new ReadLocalFileBytesError("not_found", "Local file not found on device.");
  }
  const size = Number(info.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    throw new ReadLocalFileBytesError("empty", "Local file is empty.");
  }
  return size;
}
