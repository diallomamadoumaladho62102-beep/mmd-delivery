import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import { supabase } from "./supabase";
import { vehiclePhotoStoragePath } from "./driverVehiclePhotoPath";

export { vehiclePhotoStoragePath } from "./driverVehiclePhotoPath";

const AVATARS_BUCKET = "avatars";
const MAX_BYTES = 6 * 1024 * 1024;

function sanitizeBase64(value: string) {
  return String(value || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
}

function base64ToUint8Array(base64Value: string) {
  const base64 = sanitizeBase64(base64Value);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < base64.length; i += 1) {
    const char = base64[i];
    if (char === "=") break;
    const value = alphabet.indexOf(char);
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

export function resolveVehiclePhotoPublicUrl(
  photoPath: string | null | undefined,
): string | null {
  const raw = String(photoPath ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(
    raw.replace(/^avatars\//i, ""),
  );
  return data?.publicUrl ?? null;
}

async function compressVehiclePhoto(uri: string): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    {
      compress: 0.72,
      format: ImageManipulator.SaveFormat.JPEG,
      // Strip EXIF orientation issues by re-encoding.
    },
  );
  return manipulated.uri;
}

async function pickVehiclePhoto(
  source: "camera" | "gallery",
): Promise<string | null> {
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Camera",
        "Allow camera access to photograph your vehicle.",
      );
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 10],
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return result.assets[0].uri;
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      "Photos",
      "Allow photo library access to choose a vehicle photo.",
    );
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.85,
    allowsEditing: true,
    aspect: [16, 10],
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

/**
 * Upload a real vehicle photo to the public avatars bucket and return the
 * durable object path (not a temporary signed URL).
 */
export async function uploadDriverVehiclePhotoFromUri(input: {
  vehicleId: string;
  localUri: string;
  previousPath?: string | null;
}): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) throw new Error("session_expired");

  const compressedUri = await compressVehiclePhoto(input.localUri);
  const base64 = await FileSystem.readAsStringAsync(compressedUri, {
    encoding: "base64" as any,
  });
  const bytes = base64ToUint8Array(base64);
  if (bytes.byteLength === 0) throw new Error("photo_empty");
  if (bytes.byteLength > MAX_BYTES) throw new Error("photo_too_large");

  const storagePath = vehiclePhotoStoragePath(uid, input.vehicleId);
  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });
  if (uploadError) throw uploadError;

  const previous = String(input.previousPath ?? "").trim();
  if (
    previous &&
    previous !== storagePath &&
    previous.includes(`/vehicles/${input.vehicleId}/`)
  ) {
    void supabase.storage.from(AVATARS_BUCKET).remove([previous]);
  }

  return storagePath;
}

export async function uploadDriverVehiclePhoto(input: {
  vehicleId: string;
  source: "camera" | "gallery";
  previousPath?: string | null;
}): Promise<string> {
  const pickedUri = await pickVehiclePhoto(input.source);
  if (!pickedUri) throw new Error("photo_cancelled");
  return uploadDriverVehiclePhotoFromUri({
    vehicleId: input.vehicleId,
    localUri: pickedUri,
    previousPath: input.previousPath,
  });
}

export async function deleteDriverVehiclePhotoFile(
  photoPath: string | null | undefined,
): Promise<void> {
  const path = String(photoPath ?? "")
    .trim()
    .replace(/^avatars\//i, "");
  if (!path || !path.includes("/vehicles/")) return;
  await supabase.storage.from(AVATARS_BUCKET).remove([path]);
}
