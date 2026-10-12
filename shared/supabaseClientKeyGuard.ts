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
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let bits = 0;
  let value = 0;
  let decoded = "";
  for (const char of padded) {
    if (char === "=") break;
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("invalid base64");
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return decoded;
}
