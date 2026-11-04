import * as ImagePicker from "expo-image-picker";
import { readLocalFileBytes } from "./readLocalFileBytes";
import { supabase } from "./supabase";

const MENU_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;

export async function uploadMenuItemImage(
  menuItemId: string,
  restaurantId: string
) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  const ext =
    asset.fileName?.split(".").pop()?.toLowerCase() || "jpg";

  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
      ? "image/webp"
      : "image/jpeg";

  // expo-file-system path only (avoids RCTFileReaderModule / iOS EXC_BAD_ACCESS).
  const { bytes } = await readLocalFileBytes({
    uri: asset.uri,
    mime: asset.mimeType ?? contentType,
    allowedMimes: MENU_IMAGE_MIMES,
    maxBytes: 10 * 1024 * 1024,
  });

  const path = `restaurants/${restaurantId}/menu_items/${menuItemId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("restaurant-menu")
    .upload(path, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from("restaurant_items")
    .update({ image_url: path, updated_at: new Date().toISOString() })
    .eq("id", menuItemId);

  if (dbError) throw dbError;

  return path;
}
