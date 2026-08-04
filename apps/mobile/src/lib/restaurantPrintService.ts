type TicketItem = {
  name: string;
  quantity: number;
  line_total?: number | null;
  options?: unknown;
  notes?: string | null;
  category?: string | null;
};

export type TicketPayload = {
  order_id: string;
  order_number: string;
  restaurant_name: string;
  restaurant_address?: string | null;
  created_at: string | null;
  order_type?: string | null;
  client_label?: string | null;
  dropoff_address?: string | null;
  delivery_instructions?: string | null;
  kitchen_notes?: string | null;
  items: TicketItem[];
  /** Kept for payload compatibility — never rendered on kitchen tickets. */
  total?: number | null;
  currency?: string | null;
  pickup_code: string | null;
  dropoff_code?: string | null;
  special_instructions?: string | null;
  show_qr_code?: boolean;
  show_special_instructions?: boolean;
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

function formatOptionLines(options: unknown): string[] {
  if (!options) return [];
  if (typeof options === "string") {
    const trimmed = options.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(options)) {
    return options
      .map((opt) => {
        if (typeof opt === "string") return opt.trim();
        if (opt && typeof opt === "object") {
          const row = opt as Record<string, unknown>;
          return String(row.name ?? row.label ?? row.title ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof options === "object") {
    return Object.entries(options as Record<string, unknown>)
      .map(([key, value]) => {
        if (value == null || value === false) return "";
        if (value === true) return key;
        return `${key}: ${String(value)}`;
      })
      .filter(Boolean);
  }
  return [];
}

function formatTicketDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

/**
 * Kitchen / ops thermal ticket — no prices, Stripe, driver, or support.
 * Optimized for 58mm and 80mm paper.
 */
export function buildRestaurantTicketHtml(payload: TicketPayload): string {
  const narrow = payload.paper_width === "58mm";
  const width = narrow ? "58mm" : "80mm";
  const baseFont = narrow ? "11px" : "13px";
  const codeFont = narrow ? "28px" : "34px";
  const pad = narrow ? "2mm" : "4mm";

  const pickup =
    String(payload.pickup_code ?? "").trim() ||
    String(payload.order_number ?? "").trim() ||
    "————";

  const deliveryInstructions = [
    payload.delivery_instructions,
    payload.show_special_instructions === false
      ? null
      : payload.special_instructions,
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" · ");

  const kitchenNotes = String(payload.kitchen_notes ?? "").trim();

  const itemsHtml = (payload.items ?? [])
    .map((item) => {
      const options = formatOptionLines(item.options);
      const note = String(item.notes ?? "").trim();
      const optionHtml = options
        .map((o) => `<div class="opt">· ${escapeHtml(o)}</div>`)
        .join("");
      const noteHtml = note
        ? `<div class="opt">※ ${escapeHtml(note)}</div>`
        : "";
      return `<div class="item">
        <div class="item-row">
          <span class="qty">${escapeHtml(String(item.quantity))}x</span>
          <span class="name">${escapeHtml(item.name)}</span>
        </div>
        ${optionHtml}
        ${noteHtml}
      </div>`;
    })
    .join("");

  const clientBlock = payload.client_label
    ? `<div class="row"><span class="k">Client</span><span class="v">${escapeHtml(payload.client_label)}</span></div>`
    : "";
  const addressBlock = payload.dropoff_address
    ? `<div class="row"><span class="k">Adresse</span><span class="v">${escapeHtml(payload.dropoff_address)}</span></div>`
    : "";
  const instrBlock = deliveryInstructions
    ? `<div class="row"><span class="k">Instructions</span><span class="v">${escapeHtml(deliveryInstructions)}</span></div>`
    : "";
  const kitchenBlock = kitchenNotes
    ? `<div class="kitchen"><div class="kitchen-title">NOTE CUISINE</div><div>${escapeHtml(kitchenNotes)}</div></div>`
    : "";

  const restaurantAddress = String(payload.restaurant_address ?? "").trim();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${width} auto; margin: ${pad}; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    font-size: ${baseFont};
    color: #000;
    width: ${width};
    margin: 0;
    padding: 0;
    line-height: 1.35;
  }
  .brand {
    text-align: center;
    font-weight: 900;
    letter-spacing: 1.5px;
    font-size: ${narrow ? "12px" : "14px"};
    margin-bottom: 4px;
  }
  .restaurant {
    text-align: center;
    font-weight: 800;
    font-size: ${narrow ? "13px" : "15px"};
  }
  .addr {
    text-align: center;
    font-size: ${narrow ? "10px" : "11px"};
    margin-top: 2px;
    color: #222;
  }
  .rule {
    border: none;
    border-top: 1px dashed #000;
    margin: 8px 0;
  }
  .meta { margin: 2px 0; }
  .meta strong { font-weight: 800; }
  .code-box {
    border: 2px solid #000;
    padding: ${narrow ? "8px 4px" : "12px 8px"};
    text-align: center;
    margin: 10px 0;
  }
  .code-label {
    font-size: ${narrow ? "10px" : "11px"};
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .code {
    font-size: ${codeFont};
    font-weight: 900;
    letter-spacing: ${narrow ? "3px" : "5px"};
    margin: 6px 0 4px;
    font-variant-numeric: tabular-nums;
  }
  .code-hint {
    font-size: ${narrow ? "9px" : "10px"};
  }
  .section-title {
    font-weight: 900;
    font-size: ${narrow ? "10px" : "11px"};
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin: 8px 0 4px;
  }
  .row { margin: 3px 0; }
  .k { display: block; font-weight: 800; font-size: ${narrow ? "9px" : "10px"}; text-transform: uppercase; }
  .v { display: block; }
  .item { margin: 6px 0; }
  .item-row { display: flex; gap: 6px; align-items: flex-start; }
  .qty {
    font-weight: 900;
    min-width: ${narrow ? "22px" : "28px"};
  }
  .name { font-weight: 700; flex: 1; }
  .opt { margin-left: ${narrow ? "28px" : "34px"}; font-size: ${narrow ? "10px" : "11px"}; }
  .kitchen {
    border: 1px solid #000;
    padding: 6px;
    margin-top: 8px;
  }
  .kitchen-title { font-weight: 900; margin-bottom: 3px; font-size: ${narrow ? "10px" : "11px"}; }
  .footer {
    text-align: center;
    margin-top: 10px;
    font-size: ${narrow ? "10px" : "11px"};
    font-weight: 700;
  }
</style>
</head>
<body>
  <div class="brand">MMD DELIVERY</div>
  <div class="restaurant">${escapeHtml(payload.restaurant_name || "Restaurant")}</div>
  ${restaurantAddress ? `<div class="addr">${escapeHtml(restaurantAddress)}</div>` : ""}
  <hr class="rule" />
  <div class="meta"><strong>Commande</strong> #${escapeHtml(payload.order_number)}</div>
  <div class="meta"><strong>Date</strong> ${escapeHtml(formatTicketDate(payload.created_at))}</div>
  ${payload.order_type ? `<div class="meta"><strong>Type</strong> ${escapeHtml(payload.order_type)}</div>` : ""}

  <div class="code-box">
    <div class="code-label">🔐 Code Pickup</div>
    <div class="code">${escapeHtml(pickup)}</div>
    <div class="code-hint">Communiquez ce code uniquement au livreur</div>
  </div>

  <div class="section-title">Livraison</div>
  ${clientBlock}
  ${addressBlock}
  ${instrBlock}

  <hr class="rule" />
  <div class="section-title">Commande</div>
  ${itemsHtml || `<div class="meta">Aucun article</div>`}
  ${kitchenBlock}

  <hr class="rule" />
  <div class="footer">${narrow ? "Merci !" : "Merci pour votre confiance — MMD Delivery"}</div>
</body>
</html>`;
}

async function loadExpoPrint() {
  try {
    return await import("expo-print");
  } catch (error) {
    const message = error instanceof Error ? error.message : "expo_print_unavailable";
    if (/ExpoPrint|native module/i.test(message)) {
      throw new Error("print_unavailable");
    }
    throw error;
  }
}

export async function printRestaurantTicket(payload: TicketPayload, copies = 1) {
  const Print = await loadExpoPrint();
  const html = buildRestaurantTicketHtml(payload);
  for (let i = 0; i < copies; i += 1) {
    try {
      await Print.printAsync({ html });
    } catch (error) {
      const message = error instanceof Error ? error.message : "print_failed";
      if (/ExpoPrint|native module/i.test(message)) {
        throw new Error("print_unavailable");
      }
      throw error;
    }
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
