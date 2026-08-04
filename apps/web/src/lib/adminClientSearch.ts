/**
 * Safe search filter builder for GET /api/admin/clients.
 * Detects UUID vs free-text so emails/phones are never cast to uuid.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAdminClientSearchUuid(value: string): boolean {
  return UUID_RE.test(String(value ?? "").trim());
}

/** Strip PostgREST-sensitive wildcard / delimiter chars from user input. */
export function sanitizeAdminClientSearchTerm(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns a PostgREST `.or(...)` filter string, or null when no search applies.
 * - UUID → id equality only
 * - otherwise → name / email / phone / phone_e164 ilike (never id.eq)
 */
export function buildAdminClientsSearchOr(qRaw: string): string | null {
  const q = String(qRaw ?? "").trim();
  if (!q) return null;

  if (isAdminClientSearchUuid(q)) {
    return `id.eq.${q}`;
  }

  const term = sanitizeAdminClientSearchTerm(q);
  if (!term) return null;

  const pattern = `%${term}%`;
  const parts = [
    `full_name.ilike.${pattern}`,
    `email.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `phone_e164.ilike.${pattern}`,
  ];

  const digits = term.replace(/\D/g, "");
  if (digits.length >= 4 && digits !== term) {
    parts.push(`phone.ilike.%${digits}%`);
    parts.push(`phone_e164.ilike.%${digits}%`);
  }

  return parts.join(",");
}
