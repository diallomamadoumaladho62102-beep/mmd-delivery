/** UI labels for order / payment / role enums. Internal values stay English. */

export type UiTranslator = (source: string) => string;

export function orderStatusUiLabel(
  status: string | null | undefined,
  t: UiTranslator,
): string {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "pending":
      return t("En attente");
    case "accepted":
      return t("Acceptée par le restaurant");
    case "prepared":
      return t("En préparation");
    case "assigned":
      return t("Assignée");
    case "ready":
      return t("Prête (en attente du driver)");
    case "dispatched":
      return t("En livraison");
    case "picked_up":
      return t("Récupérée");
    case "delivered":
      return t("Livrée");
    case "canceled":
    case "cancelled":
      return t("Annulée");
    default:
      return status ? String(status) : "—";
  }
}

export function orderKindUiLabel(
  kind: string | null | undefined,
  t: UiTranslator,
): string {
  const k = String(kind ?? "").toLowerCase();
  if (k === "pickup_dropoff") return t("Pickup & dropoff");
  if (k === "food") return t("Commande restaurant");
  if (k === "taxi") return t("Taxi");
  if (!k) return "—";
  return String(kind);
}

export function roleUiLabel(
  role: string | null | undefined,
  t: UiTranslator,
): string {
  const r = String(role ?? "").toLowerCase();
  if (r === "client") return t("Client");
  if (r === "driver") return t("Chauffeur");
  if (r === "restaurant") return t("Restaurant");
  if (r === "admin") return t("Administrateur");
  if (!r) return "—";
  return String(role);
}

export function transportModeUiLabel(
  value: string | null | undefined,
  t: UiTranslator,
): string {
  if (value === "bike") return t("Vélo");
  if (value === "moto") return t("Moto / Scooter");
  if (value === "car") return t("Voiture");
  return value ? String(value) : "—";
}

export function localizeIdentityWaitSla(
  label: string | null | undefined,
  t: UiTranslator,
): string | null {
  if (!label) return null;
  const minutesOnly = /^En attente depuis (\d+) min$/.exec(label);
  if (minutesOnly) return `${t("En attente depuis")} ${minutesOnly[1]} min`;
  const hoursOnly = /^En attente depuis (\d+) h$/.exec(label);
  if (hoursOnly) return `${t("En attente depuis")} ${hoursOnly[1]} h`;
  const hoursMinutes = /^En attente depuis (\d+) h (\d+)$/.exec(label);
  if (hoursMinutes) {
    return `${t("En attente depuis")} ${hoursMinutes[1]} h ${hoursMinutes[2]}`;
  }
  return t(label);
}
