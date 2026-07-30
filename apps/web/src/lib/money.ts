import {
  formatMoney as formatMoneyI18n,
  formatMoneyFromCents,
} from "@/i18n/formatters";

/**
 * @deprecated Prefer `@/i18n/formatters` (`formatMoney` / `formatMoneyFromCents`)
 * for locale-aware formatting. Kept as a thin alias for existing call sites.
 */
export function formatCurrency(
  n?: number | null,
  currency = "USD",
  locale = "fr-FR"
) {
  const v = typeof n === "number" ? n : 0;
  return formatMoneyI18n(v, currency, locale);
}

export { formatMoneyFromCents };
