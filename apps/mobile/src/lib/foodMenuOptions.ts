export type FoodMenuOption = {
  id: string;
  name: string;
  price_cents: number;
};

export function parseFoodMenuOptionsCatalog(raw: unknown): FoodMenuOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FoodMenuOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const id = String(row.id ?? name).trim();
    const priceCents = Number(row.price_cents ?? row.priceCents ?? 0);
    if (!id || !name || !Number.isFinite(priceCents) || priceCents < 0) continue;
    out.push({ id, name, price_cents: Math.round(priceCents) });
  }
  return out;
}

export function foodCartLineKey(itemId: string, options?: FoodMenuOption[]): string {
  const optionIds = (options ?? [])
    .map((option) => option.id)
    .sort()
    .join(",");
  return optionIds ? `${itemId}:${optionIds}` : itemId;
}

export function extrasCentsFromOptions(options?: FoodMenuOption[]): number {
  return (options ?? []).reduce((sum, option) => sum + option.price_cents, 0);
}
