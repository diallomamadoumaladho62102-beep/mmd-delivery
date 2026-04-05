"use client";

export default function PaymentStatusBadge({
  status,
}: {
  status: "unpaid" | "authorized" | "paid" | "refunded" | "failed";
}) {
  const cls = "px-2 py-0.5 rounded-full text-xs border";
  const map: Record<string, string> = {
    unpaid: "border-gray-300 text-gray-700",
    authorized: "border-blue-300 text-blue-700",
    paid: "border-green-300 text-green-700",
    refunded: "border-amber-300 text-amber-700",
    failed: "border-red-300 text-red-700",
  };
  return <span className={`${cls} ${map[status] || ""}`}>{status}</span>;
}

