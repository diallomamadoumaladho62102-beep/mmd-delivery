import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  prepareIdentitySelfieUpload,
  registerIdentitySelfieUpload,
} from "./driverIdentityApi";
import { supabase } from "./supabase";

const MAX_SELFIE_BYTES = 8 * 1024 * 1024;
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

function validateSelfieBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new Error("PHOTO_EMPTY");
  if (bytes.byteLength > MAX_SELFIE_BYTES) throw new Error("PHOTO_TOO_LARGE");
}

async function readSelfieBytesFromLocalUri(photoUri: string) {
  const cleanUri = String(photoUri || "").trim();
  if (!cleanUri) throw new Error("PHOTO_URI_MISSING");

  const mimeType = getMimeTypeFromPhotoUri(cleanUri);

  if (/^data:image\//i.test(cleanUri)) {
    const bytes = base64ToUint8Array(cleanUri);
    validateSelfieBytes(bytes);
    return { bytes, mimeType };
  }

  const fileUri = /^file:\/\//i.test(cleanUri)
    ? cleanUri
    : `${FILE_SYSTEM_CACHE_DIRECTORY}mmd-selfie-${Date.now()}.jpg`;

  if (!/^file:\/\//i.test(cleanUri) && FILE_SYSTEM_CACHE_DIRECTORY) {
    await FileSystem.copyAsync({ from: cleanUri, to: fileUri }).catch(() => undefined);
  }

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: getFileSystemBase64Encoding(),
  } as any);
  const bytes = base64ToUint8Array(base64);
  validateSelfieBytes(bytes);
  return { bytes, mimeType };
}

async function prepareSelfieUri(sourceUri: string) {
  const cleanSourceUri = String(sourceUri || "").trim();
  if (!cleanSourceUri) throw new Error("PHOTO_URI_MISSING");

  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      cleanSourceUri,
      [{ resize: { width: 1280 } }],
      {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      },
    );
    const manipulatedUri = String(manipulated?.uri || "").trim();
    if (manipulatedUri) {
      await readSelfieBytesFromLocalUri(manipulatedUri);
      return manipulatedUri;
    }
  } catch {
    // fall through
  }

  await readSelfieBytesFromLocalUri(cleanSourceUri);
  return cleanSourceUri;
}

export function getDriverIdentityPhotoErrorMessage(error: unknown): string {
  const code = String((error as { message?: string })?.message ?? error ?? "").trim();
  if (code === "CAMERA_PERMISSION_DENIED") {
    return "Autorisez l’accès à la caméra dans les réglages pour continuer.";
  }
  if (code === "PHOTO_EMPTY") return "La photo est vide.";
  if (code === "PHOTO_TOO_LARGE") return "La photo est trop volumineuse (max 8 Mo).";
  if (code === "PHOTO_URI_MISSING") return "Photo introuvable.";
  if (/network|fetch|timeout|failed/i.test(code)) {
    return "Erreur réseau. Vérifiez votre connexion et réessayez.";
  }
  return code || "Impossible de traiter la photo.";
}

export async function captureDriverIdentitySelfie(): Promise<string | null> {
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
    cameraType: ImagePicker.CameraType?.front ?? (ImagePicker as any).CameraType?.front,
    quality: 0.7,
    base64: false,
    exif: false,
  } as any);

  if (result.canceled || !result.assets?.length) return null;

  const sourceUri = String(result.assets[0]?.uri || "").trim();
  if (!sourceUri) throw new Error("PHOTO_URI_MISSING");

  return prepareSelfieUri(sourceUri);
}

export async function uploadDriverIdentitySelfie(params: {
  checkId: string;
  photoUri: string;
}): Promise<void> {
  const { bytes, mimeType } = await readSelfieBytesFromLocalUri(params.photoUri);
  const ext = getExtensionFromMimeType(mimeType);
  const prepared = await prepareIdentitySelfieUpload(params.checkId, ext);

  const { error: uploadError } = await supabase.storage
    .from(prepared.bucket)
    .upload(prepared.path, bytes, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  await registerIdentitySelfieUpload(params.checkId, prepared.path);
}
