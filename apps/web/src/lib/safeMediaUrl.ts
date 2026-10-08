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

/** Rebuild an allowlisted image URL. Returns null for every other value. */
export function safePublicImageSrc(value: string | null | undefined): string | null {
  if (!isSafePublicImageUrl(value)) return null;
  const raw = String(value).trim();

  if (raw.startsWith("blob:")) {
    const parsed = new URL(raw);
    return parsed.protocol === "blob:" ? parsed.href : null;
  }

  if (/^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,/i.test(raw)) {
    return raw;
  }

  const parsed = new URL(raw);
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  const allowed =
    ALLOWED_IMAGE_HOSTS.has(host) ||
    ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) return null;
  return `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`;
}
