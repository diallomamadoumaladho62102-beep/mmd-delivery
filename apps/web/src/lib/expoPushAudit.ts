export type ExpoTicketRow = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type ExpoReceiptRow = {
  status?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type ExpoSendAudit = {
  ok: boolean;
  error: string | null;
  tickets: ExpoTicketRow[];
  receipts: Record<string, ExpoReceiptRow>;
};

export async function sendExpoPushWithAudit(
  messages: Record<string, unknown>[],
  opts?: { receiptWaitMs?: number },
): Promise<ExpoSendAudit> {
  if (messages.length === 0) {
    return { ok: true, error: null, tickets: [], receipts: {} };
  }

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const out = (await res.json().catch(() => null)) as {
    data?: ExpoTicketRow[];
    errors?: Array<{ message?: string }>;
  } | null;

  if (!res.ok) {
    return {
      ok: false,
      error: out?.errors?.[0]?.message || `Expo push failed ${res.status}`,
      tickets: Array.isArray(out?.data) ? out.data : [],
      receipts: {},
    };
  }

  const tickets = Array.isArray(out?.data) ? out.data : [];
  const ticketIds = tickets
    .map((t) => String(t?.id ?? "").trim())
    .filter(Boolean);

  const waitMs = Math.max(0, Number(opts?.receiptWaitMs ?? 1500));
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }

  let receipts: Record<string, ExpoReceiptRow> = {};
  if (ticketIds.length > 0) {
    try {
      const receiptRes = await fetch(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: ticketIds }),
        },
      );
      const receiptOut = (await receiptRes.json().catch(() => null)) as {
        data?: Record<string, ExpoReceiptRow>;
      } | null;
      if (receiptOut?.data && typeof receiptOut.data === "object") {
        receipts = receiptOut.data;
      }
    } catch (e) {
      console.log(
        "[expoPushAudit] getReceipts failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const anyTicketError = tickets.some((t) => String(t?.status ?? "") === "error");
  return {
    ok: !anyTicketError,
    error: anyTicketError
      ? tickets.find((t) => t.status === "error")?.message ?? "expo_ticket_error"
      : null,
    tickets,
    receipts,
  };
}

export function maskExpoToken(token: string): string {
  const t = String(token ?? "");
  if (t.length < 16) return "…";
  return `${t.slice(0, 14)}…${t.slice(-6)}`;
}
