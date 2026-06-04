import { supabase } from "./supabaseBrowser";

const AVATARS_BUCKET = "avatars";

export function resolveAvatarUrl(value: string | null | undefined): string | null {
  const clean = String(value ?? "").trim();
  if (!clean) return null;

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  const normalized = clean.replace(/^avatars\//, "");
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(normalized);
  return data?.publicUrl ?? null;
}

export function getAvatarSrc(url: string | null | undefined): string | null {
  return resolveAvatarUrl(url);
}
