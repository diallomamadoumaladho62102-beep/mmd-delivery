import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

const PROOF_BUCKET = "delivery-proofs";
const MAX_PROOF_PHOTO_BYTES = 8 * 1024 * 1024;
const FILE_SYSTEM_CACHE_DIRECTORY = String((FileSystem as any).cacheDirectory || "");

function sanitizeBase64(value: string) {
  return String(value || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
}

function base64ToUint8Array(base64Value: string) {
  const base64 = sanitizeBase64(base64Value);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < base64.length; i += 1) {
    const char = base64[i];
    if (char === "=") break;
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

function getFileSystemBase64Encoding(): "base64" | number {
  const encodingType = (FileSystem as any).EncodingType;
  if (encodingType?.Base64 != null) return encodingType.Base64;
  return "base64";
}

function getMimeTypeFromPhotoUri(photoUri: string) {
  const cleanUri = String(photoUri || "").trim();
  if (/^data:image\//i.test(cleanUri)) {
    return cleanUri.match(/^data:([^;]+);base64,/i)?.[1] || "image/jpeg";
  }
  const withoutQuery = cleanUri.split("?")[0]?.toLowerCase() || "";
  if (withoutQuery.endsWith(".png")) return "image/png";
  if (withoutQuery.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function getExtensionFromMimeType(mimeType: string) {
  const cleanMimeType = String(mimeType || "").toLowerCase();
  if (cleanMimeType.includes("png")) return "png";
  if (cleanMimeType.includes("webp")) return "webp";
  return "jpg";
}

function validateProofPhotoBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new Error("PHOTO_EMPTY");
  if (bytes.byteLength > MAX_PROOF_PHOTO_BYTES) throw new Error("PHOTO_TOO_LARGE");
}

async function readProofPhotoBytesFromLocalUri(
  photoUri: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const cleanUri = String(photoUri || "").trim();
  if (!cleanUri) throw new Error("PHOTO_URI_MISSING");

  const mimeType = getMimeTypeFromPhotoUri(cleanUri);

  if (/^data:image\//i.test(cleanUri)) {
    const bytes = base64ToUint8Array(cleanUri);
    validateProofPhotoBytes(bytes);
    return { bytes, mimeType };
  }

  const fileUri = /^file:\/\//i.test(cleanUri)
    ? cleanUri
    : await copyProofPhotoToStableCache(cleanUri);

  const info = await FileSystem.getInfoAsync(fileUri, { size: true } as any);
  if (!(info as any)?.exists) throw new Error("PHOTO_FILE_NOT_FOUND");

  const fileSize = typeof (info as any)?.size === "number" ? (info as any).size : null;
  if (fileSize != null && fileSize > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("PHOTO_TOO_LARGE");
  }

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: getFileSystemBase64Encoding(),
  } as any);
  const bytes = base64ToUint8Array(base64);
  validateProofPhotoBytes(bytes);
  return { bytes, mimeType };
}

async function copyProofPhotoToStableCache(photoUri: string) {
  const cleanUri = String(photoUri || "").trim();
  if (!cleanUri || !FILE_SYSTEM_CACHE_DIRECTORY) return cleanUri;

  const mimeType = getMimeTypeFromPhotoUri(cleanUri);
  const destinationUri = `${FILE_SYSTEM_CACHE_DIRECTORY}mmd-proof-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${getExtensionFromMimeType(mimeType)}`;

  try {
    await FileSystem.copyAsync({ from: cleanUri, to: destinationUri });
    return destinationUri;
  } catch {
    return cleanUri;
  }
}

async function prepareProofPhotoUri(sourceUri: string) {
  const cleanSourceUri = String(sourceUri || "").trim();
  if (!cleanSourceUri) throw new Error("PHOTO_URI_MISSING");

  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      cleanSourceUri,
      [{ resize: { width: 1280 } }],
      {
        compress: 0.55,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      }
    );
    const manipulatedUri = String(manipulated?.uri || "").trim();
    if (manipulatedUri) {
      await readProofPhotoBytesFromLocalUri(manipulatedUri);
      return manipulatedUri;
    }
  } catch {
    // fall through to source uri
  }

  await readProofPhotoBytesFromLocalUri(cleanSourceUri);
  return cleanSourceUri;
}

export function getDeliveryProofPhotoErrorMessage(error: unknown): string {
  const code = String((error as { message?: string })?.message ?? error ?? "").trim();
  if (code === "PHOTO_EMPTY") return "La photo est vide.";
  if (code === "PHOTO_TOO_LARGE") return "La photo est trop volumineuse (max 8 Mo).";
  if (code === "PHOTO_URI_MISSING") return "Photo introuvable.";
  if (code === "PHOTO_FILE_NOT_FOUND") return "Fichier photo introuvable.";
  if (code === "PHOTO_READ_FAILED") return "Impossible de lire la photo.";
  if (/network|fetch|timeout/i.test(code)) return "Erreur réseau. Réessaie.";
  return code || "Impossible de traiter la photo.";
}

export async function captureDeliveryProofPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("CAMERA_PERMISSION_DENIED");
  }

  const mediaTypes =
    (ImagePicker as any)?.MediaType?.Images ??
    (ImagePicker as any)?.MediaTypeOptions?.Images ??
    "images";

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes,
    allowsEditing: false,
    quality: 0.65,
    base64: false,
    exif: false,
  } as any);

  if (result.canceled || !result.assets?.length) return null;

  const sourceUri = String(result.assets[0]?.uri || "").trim();
  if (!sourceUri) throw new Error("PHOTO_URI_MISSING");

  return prepareProofPhotoUri(sourceUri);
}

export async function uploadDeliveryProofPhoto(params: {
  entityId: string;
  photoUri: string;
}): Promise<string> {
  const { entityId, photoUri } = params;
  const { bytes, mimeType } = await readProofPhotoBytesFromLocalUri(photoUri);
  const extension = getExtensionFromMimeType(mimeType);
  const filePath = `${entityId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(PROOF_BUCKET).upload(filePath, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(PROOF_BUCKET).getPublicUrl(filePath);
  const publicUrl = String(data?.publicUrl ?? "").trim();
  if (!publicUrl) throw new Error("PROOF_PUBLIC_URL_MISSING");
  return publicUrl;
}
