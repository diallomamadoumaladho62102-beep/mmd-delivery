/** True when a key must never be placed in a browser or mobile client. */
export function isPrivilegedSupabaseClientKey(key: string): boolean {
  const value = String(key ?? "").trim();
  if (!value) return false;
  if (value.startsWith("sb_secret_")) return true;
  if (!value.startsWith("eyJ")) return false;
  const parts = value.split(".");
  if (parts.length < 3) return false;
  try {
    const json = JSON.parse(decodeBase64Url(parts[1])) as { role?: unknown };
    return String(json.role ?? "") === "service_role";
  } catch {
    return false;
  }
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof globalThis.atob === "function") return globalThis.atob(padded);
  return Buffer.from(padded, "base64").toString("utf8");
}
