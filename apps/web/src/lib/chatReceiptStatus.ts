export type ChatDeliveryStatus = "sent" | "delivered" | "read";

export function formatChatReceiptLabel(
  status: ChatDeliveryStatus | string | null | undefined,
): string {
  const normalized = String(status ?? "sent").trim().toLowerCase();
  if (normalized === "read") return "Lu";
  if (normalized === "delivered") return "Distribué";
  return "Envoyé";
}

export function mapTwilioCallStatus(raw: string):
  | "ringing"
  | "connected"
  | "completed"
  | "missed"
  | "declined"
  | "failed"
  | "canceled"
  | null {
  const status = String(raw ?? "").trim().toLowerCase();
  if (!status) return null;

  if (status === "queued" || status === "initiated" || status === "ringing") {
    return "ringing";
  }
  if (status === "in-progress" || status === "answered") {
    return "connected";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "busy") {
    return "declined";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "no-answer") {
    return "missed";
  }
  if (status === "canceled" || status === "cancelled") {
    return "canceled";
  }

  return null;
}
