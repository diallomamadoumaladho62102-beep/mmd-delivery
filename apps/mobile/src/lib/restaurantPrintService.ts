import * as Print from "expo-print";

type TicketPayload = {
  order_id: string;
  order_number: string;
  restaurant_name: string;
  created_at: string | null;
  items: Array<{
    name: string;
    quantity: number;
    line_total?: number | null;
    options?: unknown;
  }>;
  total: number | null;
  currency: string | null;
  pickup_code: string | null;
  dropoff_code: string | null;
  special_instructions: string | null;
  show_qr_code: boolean;
  show_special_instructions: boolean;
  paper_width: "58mm" | "80mm";
  ticket_type: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ticketTitle(jobType: string) {
  switch (jobType) {
    case "kitchen":
      return "TICKET CUISINE";
    case "customer":
      return "TICKET CLIENT";
    case "driver":
      return "TICKET CHAUFFEUR";
    default:
      return "TEST IMPRESSION";
  }
}

export function buildRestaurantTicketHtml(payload: TicketPayload): string {
  const width = payload.paper_width === "58mm" ? "58mm" : "80mm";
  const itemsHtml = payload.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)} x${item.quantity}</td><td style="text-align:right">${item.line_total ?? ""}</td></tr>`,
    )
    .join("");

  const qrBlock = payload.show_qr_code
    ? `<div class="qr">#${escapeHtml(payload.order_number)}</div>`
    : "";

  const instructions =
    payload.show_special_instructions && payload.special_instructions
      ? `<div class="note"><strong>Instructions:</strong> ${escapeHtml(payload.special_instructions)}</div>`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${width} auto; margin: 4mm; }
  body { font-family: monospace; font-size: 12px; color: #111; width: ${width}; }
  h1 { font-size: 16px; margin: 0 0 8px; text-align: center; }
  .meta { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; vertical-align: top; }
  .total { font-weight: bold; margin-top: 8px; }
  .qr { margin-top: 10px; font-size: 18px; text-align: center; letter-spacing: 2px; }
  .note { margin-top: 8px; border-top: 1px dashed #999; padding-top: 8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(ticketTitle(payload.ticket_type))}</h1>
  <div class="meta">${escapeHtml(payload.restaurant_name)}</div>
  <div class="meta">Commande ${escapeHtml(payload.order_number)}</div>
  <div class="meta">${escapeHtml(String(payload.created_at ?? ""))}</div>
  <table>${itemsHtml}</table>
  <div class="total">Total: ${payload.total ?? ""} ${escapeHtml(String(payload.currency ?? ""))}</div>
  ${instructions}
  ${qrBlock}
</body>
</html>`;
}

export async function printRestaurantTicket(payload: TicketPayload, copies = 1) {
  const html = buildRestaurantTicketHtml(payload);
  for (let i = 0; i < copies; i += 1) {
    await Print.printAsync({ html });
  }
}

export async function printRestaurantTicketSafe(
  payload: TicketPayload,
  copies = 1,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await printRestaurantTicket(payload, copies);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "print_failed";
    if (/cancel/i.test(message)) {
      return { ok: false, error: "print_cancelled" };
    }
    return { ok: false, error: message };
  }
}
