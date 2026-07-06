const PROOF_BUCKET = "delivery-proofs";
export const DELIVERY_PROOF_URL_MAX_LENGTH = 2048;
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
]);

const STORAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(pickup|delivery|dropoff|pickup_dropoff)-[\w.-]+\.(jpe?g|png|webp|heic|heif)$/i;

function getSupabaseHostnames(): Set<string> {
  const hosts = new Set<string>();
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!raw) return hosts;

  try {
    hosts.add(new URL(raw).hostname.toLowerCase());
  } catch {
    // ignore invalid env
  }
  return hosts;
}

function extensionFromPath(path: string): string | null {
  const match = path.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extractDeliveryProofStoragePath(rawValue: string): string | null {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;

  if (STORAGE_PATH_PATTERN.test(raw)) {
    return raw;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const allowedHosts = getSupabaseHostnames();
  if (allowedHosts.size > 0 && !allowedHosts.has(host)) {
    return null;
  }

  const pathname = decodeURIComponent(parsed.pathname);
  const signPrefix = `/storage/v1/object/sign/${PROOF_BUCKET}/`;
  const publicPrefix = `/storage/v1/object/public/${PROOF_BUCKET}/`;

  let objectPath = "";
  if (pathname.startsWith(signPrefix)) {
    objectPath = pathname.slice(signPrefix.length);
  } else if (pathname.startsWith(publicPrefix)) {
    objectPath = pathname.slice(publicPrefix.length);
  } else {
    return null;
  }

  objectPath = objectPath.replace(/^\/+/, "").split("?")[0]?.trim() ?? "";
  if (!objectPath || !STORAGE_PATH_PATTERN.test(objectPath)) {
    return null;
  }

  const ext = extensionFromPath(objectPath);
  if (!ext || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return null;
  }

  return objectPath;
}

export function normalizeDeliveryProofPhotoUrl(
  value: unknown,
  options?: { orderId?: string | null }
): string {
  const raw = String(value ?? "").trim();

  if (!raw) {
    throw new Error("Missing proof_photo_url");
  }

  if (raw.length > DELIVERY_PROOF_URL_MAX_LENGTH) {
    throw new Error("Invalid proof_photo_url");
  }

  const storagePath = extractDeliveryProofStoragePath(raw);
  if (!storagePath) {
    throw new Error("Invalid proof_photo_url");
  }

  const orderId = String(options?.orderId ?? "").trim();
  if (orderId) {
    const pathOrderId = storagePath.split("/")[0]?.toLowerCase();
    if (pathOrderId !== orderId.toLowerCase()) {
      throw new Error("Invalid proof_photo_url");
    }
  }

  return storagePath;
}
