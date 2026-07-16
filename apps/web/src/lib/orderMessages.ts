/** Canonical order_messages columns used in production (text, image_path). */

export type OrderMessageRow = {
  id: string;
  order_id: string;
  user_id?: string | null;
  text: string | null;
  image_path: string | null;
  sender_role: string | null;
  target_role: string | null;
  created_at: string | null;
};

export const ORDER_MESSAGE_SELECT =
  "id, order_id, user_id, text, image_path, sender_role, target_role, delivery_status, delivered_at, read_at, created_at";

export function messagePreview(row: {
  text?: string | null;
  image_path?: string | null;
}): string {
  const text = String(row.text ?? "").trim();
  if (text) return text;
  if (row.image_path) return "Image jointe";
  return "—";
}
