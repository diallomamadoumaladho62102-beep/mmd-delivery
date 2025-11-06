'use client';
import { use } from 'react';
import JoinButton from '@/components/JoinButton';
import LeaveButton from '@/components/LeaveButton';
import MembersList from '@/components/MembersList';
import OrderAlerts from '@/components/OrderAlerts';
import { useOrderRole } from '@/hooks/useOrderRole';
import CommissionBreakdown from "@/components/CommissionBreakdown";
import StatusTester from "@/components/StatusTester";
import RoleSwitch from "@/components/RoleSwitch";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";
import RestaurantCommission from "@/components/RestaurantCommission";
export default function ChatPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const shortId = orderId?.slice(0, 8) ?? '???';
  const role = useOrderRole(orderId);

  return (
    <main className="p-6 space-y-6">      <div className="text-xs text-gray-500">
        
      </div>

      {!orderId ? (
        <h1 className="text-xl font-semibold text-red-600">Order ID manquant</h1>
):(
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">Chat — commande #{shortId}</h1>
<OrderAlerts orderId={orderId} role="driver" />
            <OrderStatusBadge orderId={orderId} />
          </div>

          {role && <OrderAlerts role={role} />}

          <div className="grid md:grid-cols-2 gap-6">
            {/* Colonne gauche : membres & chat */}
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <JoinButton orderId={orderId} />
                <LeaveButton orderId={orderId} />
              </div>
              <MembersList orderId={orderId} />
              <div className="space-y-3">
                <ChatMessages orderId={orderId} />
                <ChatInput orderId={orderId} />
              </div>
            </div>

            {/* Colonne droite : commissions, statut, rôle, timeline */}
            <div className="space-y-4">
              <CommissionBreakdown orderId={orderId} />
              <StatusTester orderId={orderId} />
              <RoleSwitch orderId={orderId} />
              <OrderStatusTimeline orderId={orderId} />
            </div>
          </div>
        </>
      )}
      <RestaurantCommission orderId={orderId} />
</main>
  );
}







