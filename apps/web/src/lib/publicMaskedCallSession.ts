const PRIVATE_PHONE_KEYS = [
  "caller_phone",
  "target_phone",
  "callerPhone",
  "targetPhone",
];

export type PublicMaskedCallSession = {
  id: string;
  order_id: string | null;
  caller_role: string | null;
  target_role: string | null;
  status: string | null;
  proxy_number: string | null;
  expires_at: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toPublicMaskedCallSession(
  session: unknown,
  proxyNumber?: string | null
): PublicMaskedCallSession | null {
  const row = asRecord(session);
  if (!row) return null;

  const id = String(row.id ?? "").trim();
  if (!id) return null;

  return {
    id,
    order_id: row.order_id != null ? String(row.order_id) : null,
    caller_role: row.caller_role != null ? String(row.caller_role) : null,
    target_role: row.target_role != null ? String(row.target_role) : null,
    status: row.status != null ? String(row.status) : null,
    proxy_number:
      String(proxyNumber ?? row.proxy_number ?? "").trim() || null,
    expires_at: row.expires_at != null ? String(row.expires_at) : null,
  };
}

export function sessionContainsPrivatePhone(value: unknown): boolean {
  const json = JSON.stringify(value ?? {});
  if (!json) return false;
  if (PRIVATE_PHONE_KEYS.some((key) => json.includes(`"${key}"`))) {
    return true;
  }
  return /"(caller_phone|target_phone)"\s*:/.test(json);
}
