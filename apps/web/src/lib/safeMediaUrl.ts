const ALLOWED_IMAGE_HOST_SUFFIXES = [".supabase.co"];
const ALLOWED_IMAGE_HOSTS = new Set([
  "images.unsplash.com",
  "lh3.googleusercontent.com",
]);

/**
 * Only render http(s) image URLs from known hosts, or local file previews.
 * Blocks javascript:/data:text HTML XSS via <img src>.
 */
export function isSafePublicImageUrl(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048) return false;

  if (raw.startsWith("blob:")) return true;
  if (/^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,/i.test(raw)) return true;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_IMAGE_HOSTS.has(host)) return true;
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
