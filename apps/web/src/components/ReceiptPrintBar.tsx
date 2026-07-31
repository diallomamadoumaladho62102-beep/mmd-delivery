/** Shared print/download control for authenticated web receipt pages. */
"use client";

export function ReceiptPrintBar(props: { label?: string }) {
  const label = props.label ?? "Print / Save PDF";
  return (
    <div
      className="receipt-print-bar"
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginBottom: 16,
      }}
    >
      <button
        type="button"
        onClick={() => window.print()}
        style={{
          border: "1px solid #cbd5e1",
          background: "#0f172a",
          color: "#f8fafc",
          borderRadius: 8,
          padding: "8px 14px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
      <style>{`
        @media print {
          .receipt-print-bar { display: none !important; }
        }
      `}</style>
    </div>
  );
}
