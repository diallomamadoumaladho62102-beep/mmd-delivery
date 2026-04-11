import Link from "next/link";
import AdminOnly from "@/components/AdminOnly";
import AdminCommissionsTable from "@/components/AdminCommissionsTable";

const adminLinks = [
  {
    href: "/admin/drivers",
    title: "🚗 Chauffeurs",
    description: "Vérifier les profils drivers",
  },
  {
    href: "/admin/restaurants",
    title: "🍽️ Restaurants",
    description: "Vérifier les restaurants",
  },
  {
    href: "/admin/payouts",
    title: "💸 Payouts",
    description: "Gestion des paiements, retries, audit et reconciliation",
  },
  {
    href: "/admin/orders",
    title: "📦 Commandes",
    description: "Parcourir les commandes et ouvrir le détail admin",
  },
  {
    href: "/admin/audit",
    title: "📊 Audit Logs",
    description: "Historique global des actions administrateur",
  },
];

export default function AdminPage() {
  return (
    <AdminOnly>
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <header className="space-y-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Admin Dashboard
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Admin — Tableau de bord
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Accès réservé aux administrateurs. Utilise ce tableau de bord
                pour superviser les commandes, les validations, les payouts et
                les audits.
              </p>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {adminLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50"
              >
                <div className="font-medium text-slate-900">{link.title}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {link.description}
                </div>
              </Link>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                Commissions récentes
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Vue de contrôle admin des commissions calculées sur les dernières
                commandes.
              </p>
            </div>

            <AdminCommissionsTable />
          </section>
        </div>
      </main>
    </AdminOnly>
  );
}
