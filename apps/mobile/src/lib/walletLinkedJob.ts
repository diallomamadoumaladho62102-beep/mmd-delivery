/**
 * Open the real delivery/taxi job linked from a wallet ledger row.
 * Never invents ids — if reference is missing, the caller shows an empty/no-op.
 */
export type WalletLinkedRef = {
  reference_type?: string | null;
  reference_id?: string | null;
  entry_type?: string | null;
  description?: string | null;
};

export type WalletLinkedTarget =
  | { kind: "delivery_request"; id: string }
  | { kind: "taxi_ride"; id: string }
  | { kind: "order"; id: string }
  | null;

function firstUuid(value: string): string | null {
  const m = value.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

export function resolveWalletLinkedJob(item: WalletLinkedRef): WalletLinkedTarget {
  const type = `${item.reference_type ?? ""} ${item.entry_type ?? ""}`
    .toLowerCase()
    .trim();
  const id = String(item.reference_id ?? "").trim();
  const fromDesc = firstUuid(String(item.description ?? ""));
  const resolvedId = id || fromDesc || "";
  if (!resolvedId) return null;

  if (type.includes("taxi") || type.includes("ride")) {
    return { kind: "taxi_ride", id: resolvedId };
  }
  if (type.includes("delivery_request") || type.includes("package")) {
    return { kind: "delivery_request", id: resolvedId };
  }
  if (type.includes("order") || type.includes("food")) {
    return { kind: "order", id: resolvedId };
  }
  if (id) {
    return { kind: "delivery_request", id };
  }
  return null;
}
