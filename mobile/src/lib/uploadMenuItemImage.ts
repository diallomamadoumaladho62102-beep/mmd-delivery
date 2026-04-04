import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

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
  const response = await fetch(asset.uri);
  const arrayBuffer = await response.arrayBuffer();

  const ext =
    asset.fileName?.split(".").pop()?.toLowerCase() || "jpg";

  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
      ? "image/webp"
      : "image/jpeg";

  const path = `restaurants/${restaurantId}/menu_items/${menuItemId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("restaurant-menu")
    .upload(path, arrayBuffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { error: dbError } = await supabase
    .from("restaurant_menu_items")
    .update({ image_path: path })
    .eq("id", menuItemId);

  if (dbError) throw dbError;

  return path;
}
