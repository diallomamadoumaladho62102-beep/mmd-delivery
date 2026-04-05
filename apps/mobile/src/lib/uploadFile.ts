import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./supabase";

// ✅ Base64 → Uint8Array (sans Buffer, compatible RN)
function base64ToUint8Array(base64: string) {
  const clean = (base64 || "").replace(/\s/g, "");

  // atob peut ne pas exister selon l'environnement → fallback pur JS
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
}) {
  const { bucket, path, uri } = params;
  const contentType = params.contentType || guessContentType(uri);

  if (!bucket || !path || !uri) {
    throw new Error(
      `[uploadFile] missing params: bucket=${bucket} path=${path} uri=${uri}`
    );
  }

  // ✅ lecture base64 depuis le téléphone
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e: any) {
    console.log("[uploadFile] readAsStringAsync failed", { uri, e });
    throw new Error(
      `[uploadFile] impossible de lire le fichier local. uri=${uri}`
    );
  }

  // ✅ bytes
  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(base64);
  } catch (e: any) {
    console.log("[uploadFile] base64ToUint8Array failed", { uri, e });
    throw new Error("[uploadFile] conversion base64 -> bytes échouée");
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
