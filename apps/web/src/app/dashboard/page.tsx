import OrderAlerts from '@/components/OrderAlerts';

export default function Dashboard() {
  const role = 'driver'; // TODO: injecter le vrai rôle utilisateur
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <OrderAlerts role={role} />
      <div className="text-gray-600 text-sm">Contenu…</div>
    </main>
  );
}

