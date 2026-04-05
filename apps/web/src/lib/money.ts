// src/lib/money.ts
export function formatCurrency(n?: number | null, currency = "USD", locale = "fr-FR") {
  const v = typeof n === "number" ? n : 0;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(v);
}


