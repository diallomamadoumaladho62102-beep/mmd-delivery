import { supabase } from "./supabase";

export function getMenuItemImageUrl(image_path: string) {
  const { data } = supabase.storage
    .from("restaurant-menu")
    .getPublicUrl(image_path);

  return data.publicUrl;
}
