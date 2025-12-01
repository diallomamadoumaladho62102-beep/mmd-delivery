"use client";

type OrderItem = {
  menu_item_id: string;
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export default function OrderSummary({
  items = [],
  subtotal = 0,
}: {
  items: OrderItem[];
  subtotal: number;
}) {
  const total = Number(subtotal) || 0;

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-white shadow-sm">
      <h2 className="text-lg font-semibold">Détails de la commande</h2>

      {(!items || items.length === 0) && (
        <p className="text-sm text-gray-500">
          Aucun article dans cette commande.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-2 text-sm">
          {items.map((item, idx) => (
            <li
              key={item.menu_item_id ?? idx}
              className="flex justify-between"
            >
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-gray-500">
                  x {item.quantity}
                  {item.category ? ` • ${item.category}` : ""}
                </div>
              </div>
              <div className="font-medium">
                {Number(item.line_total || 0).toFixed(2)} $US
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t pt-2 mt-2 flex justify-between font-semibold">
        <span>Total</span>
        <span>{total.toFixed(2)} $US</span>
      </div>
    </div>
  );
}
