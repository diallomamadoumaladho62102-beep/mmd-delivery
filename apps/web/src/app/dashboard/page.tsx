import OrderAlerts from '@/components/OrderAlerts';

type QuickStat = {
  label: string;
  value: number;
  icon: string;
  cardClassName: string;
};

type RecentOrder = {
  id: string;
  date: string;
  pickup: string;
  dropoff: string;
  total: string;
  status: string;
  statusClassName: string;
  bullet: string;
};

export default function Dashboard() {
  const role = 'driver'; // TODO: injecter le vrai rôle utilisateur

  const currentPoints = 6;
  const nextLevelPoints = 50;
  const remainingPoints = Math.max(nextLevelPoints - currentPoints, 0);
  const progressPercent = Math.min((currentPoints / nextLevelPoints) * 100, 100);

  const quickStats: QuickStat[] = [
    {
      label: 'Orders',
      value: 3,
      icon: '📦',
      cardClassName:
        'border-blue-400/15 bg-[linear-gradient(135deg,rgba(37,99,235,0.22),rgba(15,23,42,0.88))]',
    },
    {
      label: 'In Progress',
      value: 3,
      icon: '🚕',
      cardClassName:
        'border-orange-400/15 bg-[linear-gradient(135deg,rgba(180,83,9,0.28),rgba(15,23,42,0.9))]',
    },
    {
      label: 'Completed',
      value: 0,
      icon: '✅',
      cardClassName:
        'border-emerald-400/15 bg-[linear-gradient(135deg,rgba(5,150,105,0.24),rgba(15,23,42,0.9))]',
    },
  ];

  const recentOrders: RecentOrder[] = [
    {
      id: '#d7006804',
      date: '2026-03-08 6:16 AM',
      pickup: '686 Vermont st 11207',
      dropoff: '1112 Flatbush Ave 11226',
      total: '83.84 USD',
      status: '•••',
      statusClassName:
        'border-white/10 bg-white/5 text-white/80',
      bullet: '🟡',
    },
    {
      id: '#444ea49f',
      date: '2026-02-23 5:53 AM',
      pickup: '686 Vermont st 11207',
      dropoff: '1112 Flatbush Ave 11226',
      total: '',
      status: '🚙 Driver assigned',
      statusClassName:
        'border-blue-300/15 bg-blue-400/10 text-blue-200',
      bullet: '🔵',
    },
  ];

  return (
    <main className="min-h-screen bg-[#040716] text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <section className="rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_28%),radial-gradient(circle_at_30%_10%,rgba(16,185,129,0.06),transparent_18%),linear-gradient(180deg,#060a22_0%,#040716_100%)] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:p-6">
            <div className="space-y-5">
              <div className="space-y-3">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                    👋 Good afternoon, Mamadou
                  </h1>
                  <p className="mt-2 text-lg text-white/75 sm:text-xl">
                    Level Bronze • {currentPoints} pts
                  </p>
                </div>

                <div className="max-w-xl">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="rounded-full border border-[#8c5d33]/40 bg-[#5a3721]/25 px-4 py-1 font-medium text-[#efcf88]">
                      Bronze
                    </span>
                    <span className="text-white/70">
                      {currentPoints} / {nextLevelPoints} pts
                    </span>
                  </div>

                  <div className="h-4 overflow-hidden rounded-full border border-white/10 bg-white/8 shadow-inner">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#a56a34_0%,#f3df9b_60%,#7d5a38_100%)] transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                  <p className="mt-3 text-lg text-white/75">
                    Next reward in{' '}
                    <span className="font-semibold text-white">{remainingPoints} pts</span>
                  </p>
                </div>
              </div>

              <OrderAlerts role={role} />

              <div className="grid gap-4">
                <button
                  type="button"
                  className="group overflow-hidden rounded-[28px] border border-emerald-400/15 bg-[linear-gradient(90deg,rgba(10,50,45,0.95)_0%,rgba(31,66,54,0.92)_55%,rgba(117,97,31,0.40)_82%,rgba(16,23,42,0.95)_100%)] p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition duration-200 hover:scale-[0.995] hover:border-emerald-300/25"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold sm:text-3xl">
                        📦 New Pickup / Dropoff
                      </h2>
                      <p className="text-lg text-white/75">🚗 Direct delivery</p>
                    </div>

                    <div className="hidden shrink-0 items-center justify-center sm:flex">
                      <div className="rounded-[22px] border border-white/10 bg-white/6 px-6 py-4 text-5xl shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur">
                        🍔
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="group overflow-hidden rounded-[28px] border border-blue-400/15 bg-[linear-gradient(90deg,rgba(19,31,74,0.96)_0%,rgba(30,51,118,0.88)_58%,rgba(71,85,105,0.35)_82%,rgba(16,23,42,0.96)_100%)] p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition duration-200 hover:scale-[0.995] hover:border-blue-300/25"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold sm:text-3xl">
                        🍔 Order from Restaurants
                      </h2>
                      <p className="text-lg text-white/75">🍽️ Browse menus</p>
                    </div>

                    <div className="hidden shrink-0 items-center justify-center sm:flex">
                      <div className="rounded-[22px] border border-white/10 bg-white/6 px-6 py-4 text-5xl shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur">
                        🍟
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="group overflow-hidden rounded-[28px] border border-amber-400/15 bg-[linear-gradient(90deg,rgba(79,48,15,0.90)_0%,rgba(37,44,87,0.84)_46%,rgba(78,74,63,0.30)_75%,rgba(16,23,42,0.96)_100%)] p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition duration-200 hover:scale-[0.995] hover:border-amber-300/25"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold sm:text-3xl">
                        ⭐ Reorder (Smart)
                      </h2>
                      <p className="text-lg text-white/75">Order again in 1 tap</p>
                    </div>

                    <div className="hidden shrink-0 items-center justify-center sm:flex">
                      <div className="rounded-[22px] border border-white/10 bg-white/6 px-6 py-4 text-5xl shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur">
                        🍔
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <h3 className="text-2xl font-bold tracking-tight">Quick stats</h3>

              <div className="grid gap-4 sm:grid-cols-3">
                {quickStats.map((stat) => (
                  <div
                    key={stat.label}
                    className={`rounded-[24px] border p-5 shadow-[0_10px_26px_rgba(0,0,0,0.28)] ${stat.cardClassName}`}
                  >
                    <div className="mb-3 text-2xl">{stat.icon}</div>
                    <p className="text-sm text-white/75">{stat.label}</p>
                    <p className="mt-2 text-4xl font-bold leading-none">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,37,0.96)_0%,rgba(7,10,25,0.96)_100%)] p-5 shadow-[0_14px_38px_rgba(0,0,0,0.34)]">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-2xl font-bold">📍 Nearby drivers</h3>
                  <span className="text-2xl leading-none text-white/40">•••</span>
                </div>

                <div className="mb-5 inline-flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-sm text-white/65">
                  <span>✔ Pickup</span>
                  <span>•</span>
                  <span>🟢 Driver</span>
                  <span>▶</span>
                  <span>🟡</span>
                  <span>•</span>
                  <span>Delivered</span>
                </div>

                <div className="space-y-3 text-white/82">
                  <p className="text-xl text-white/65">2026-03-08 6:16 AM</p>
                  <p className="text-xl">
                    Pickup: <span className="font-semibold text-white">686 Vermont st 11207</span>
                  </p>
                  <p className="text-xl">
                    Dropoff: <span className="font-semibold text-white">1112 Flatbush Ave 11226</span>
                  </p>
                  <p className="text-xl">
                    Distance: <span className="font-semibold text-white">4.50 mi</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-emerald-400/12 bg-[linear-gradient(135deg,rgba(6,78,59,0.55)_0%,rgba(15,23,42,0.92)_100%)] p-5 shadow-[0_14px_38px_rgba(0,0,0,0.34)]">
                <h3 className="text-2xl font-bold">🎯 Weekly Challenge</h3>
                <p className="mt-4 text-3xl font-semibold">Complete 3 deliveries</p>
                <p className="mt-2 text-xl text-emerald-200/95">Reward: +20 pts</p>

                <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,#d1fae5_0%,#86efac_55%,#4ade80_100%)]" />
                </div>

                <p className="mt-3 text-right text-2xl font-semibold">1 / 3</p>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,19,44,0.96)_0%,rgba(7,10,25,0.98)_100%)] shadow-[0_14px_38px_rgba(0,0,0,0.34)]">
                <div className="h-56 p-4">
                  <div className="relative h-full w-full overflow-hidden rounded-[24px] border border-white/8 bg-[linear-gradient(135deg,#2c3247_0%,#1b2035_50%,#131726_100%)]">
                    <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:34px_34px]" />
                    <div className="absolute left-[16%] top-[30%] rounded-full bg-slate-900/90 px-3 py-2 text-sm shadow-lg">
                      🚗 2 min
                    </div>
                    <div className="absolute left-[47%] top-[60%] rounded-full bg-slate-900/90 px-3 py-2 text-sm shadow-lg">
                      🚕 3 min
                    </div>
                    <div className="absolute right-[8%] top-[26%] rounded-full bg-emerald-900/85 px-3 py-2 text-sm text-emerald-100 shadow-lg">
                      ☁ 4 mn
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-0">
                  <h3 className="text-2xl font-bold">🚚 Nearby drivers</h3>
                  <p className="mt-2 text-lg text-white/70">3 drivers around you</p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-2xl font-bold tracking-tight">Recent orders</h3>

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-emerald-300/20 bg-[linear-gradient(90deg,#3f7f57_0%,#2fbf78_100%)] px-6 py-3 text-lg font-semibold text-white shadow-[0_10px_26px_rgba(16,185,129,0.22)] transition hover:brightness-110"
              >
                + New Order
              </button>
            </div>

            <div className="space-y-4">
              {recentOrders.map((order) => (
                <article
                  key={order.id}
                  className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,37,0.96)_0%,rgba(6,9,22,0.98)_100%)] p-5 shadow-[0_14px_38px_rgba(0,0,0,0.34)]"
                >
                  <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-3">
                      <h4 className="text-3xl font-bold tracking-tight">
                        <span className="mr-2">{order.bullet}</span>
                        {order.id}
                      </h4>

                      <p className="text-xl text-white/60">{order.date}</p>

                      <p className="text-xl text-white/82">
                        Pickup: <span className="font-semibold text-white">{order.pickup}</span>
                      </p>

                      <p className="text-xl text-white/82">
                        Dropoff: <span className="font-semibold text-white">{order.dropoff}</span>
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-4 md:items-end">
                      <span
                        className={`rounded-full border px-4 py-2 text-base font-medium ${order.statusClassName}`}
                      >
                        {order.status}
                      </span>

                      {order.total ? (
                        <p className="text-2xl font-bold">Total: {order.total}</p>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}