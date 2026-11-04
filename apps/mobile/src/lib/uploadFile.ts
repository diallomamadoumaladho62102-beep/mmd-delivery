import { readLocalFileBytes } from "./readLocalFileBytes";
import { supabase } from "./supabase";

function guessContentType(uri: string) {
  const u = (uri || "").toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function uploadFile(params: {
  bucket: string;
  path: string;
  uri: string;
  contentType?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}) {
  const { bucket, path, uri } = params;
  const contentType = params.contentType || guessContentType(uri);

  if (!bucket || !path || !uri) {
    throw new Error(
      `[uploadFile] missing params: bucket=${bucket} path=${path} uri=${uri}`
    );
  }

  // expo-file-system only — avoids RCTFileReaderModule native crashes.
  let bytes: Uint8Array;
  try {
    const read = await readLocalFileBytes({
      uri,
      mime: contentType,
      maxBytes: params.maxBytes ?? 10 * 1024 * 1024,
      signal: params.signal,
    });
    bytes = read.bytes;
  } catch (e: any) {
    console.log("[uploadFile] readLocalFileBytes failed", { uri, e });
    throw new Error(
      `[uploadFile] impossible de lire le fichier local. uri=${uri}`
    );
  }

  // ✅ retry 3 fois (réseau mobile / timeouts)
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    });

    if (!error) {
      const pub = supabase.storage.from(bucket).getPublicUrl(path);
      return { publicUrl: pub.data.publicUrl, path };
    }

    lastErr = error;
    console.log("[uploadFile] attempt failed", {
      attempt,
      bucket,
      path,
      contentType,
      error,
    });

    await sleep(500 * attempt); // 500ms, 1000ms, 1500ms
  }

  console.log("[uploadFile] final error", lastErr);
  throw lastErr;
}
