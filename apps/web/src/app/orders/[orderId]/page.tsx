import CommissionBreakdown from "@/components/CommissionBreakdown";
import { getCommissions } from "@/lib/getCommissions";
import OrderAlerts from "@/components/OrderAlerts";
import OrderStatusSimulator from "@/components/OrderStatusSimulator";

export default async function OrderPage({ params }: { params: { orderId: string } }) {
  const { orderId } = await params;
  const commissions = await getCommissions(orderId);
  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Commande #{orderId}</h1>
        <OrderAlerts orderId={orderId} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-2">Commissions</h2>
        <CommissionBreakdown data={commissions} />
      </section>

      {/* Outil de test (retirer en prod) */}
      <section className="border rounded p-3">
        <OrderStatusSimulator orderId={orderId} />
      </section>
    </main>
  );
}

