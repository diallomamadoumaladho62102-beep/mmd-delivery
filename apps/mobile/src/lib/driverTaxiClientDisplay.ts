/**
 * Pure helpers for driver taxi UX — client meeting point & avatar display.
 * No React Native imports (Node-testable).
 */

export type ClientMeetingPoint = {
  latitude: number;
  longitude: number;
};

/** Reject invalid / null-island coords. Never invent a position. */
export function resolveClientMeetingPoint(params: {
  stage: "pickup" | "dropoff";
  pickupLat: unknown;
  pickupLng: unknown;
}): ClientMeetingPoint | null {
  if (params.stage !== "pickup") return null;
  if (params.pickupLat == null || params.pickupLng == null) return null;
  if (params.pickupLat === "" || params.pickupLng === "") return null;
  const lat = Number(params.pickupLat);
  const lng = Number(params.pickupLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

export function resolveAvatarPublicUrl(
  value: string | null | undefined,
  supabaseUrl?: string | null,
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(supabaseUrl ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return null;
  const normalized = raw.replace(/^avatars\//i, "");
  return `${base}/storage/v1/object/public/avatars/${normalized}`;
}

export function clientDisplayInitials(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}
