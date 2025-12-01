import Link from "next/link";

export default function SignupLanding() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow p-6 space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Créer un compte MMD Delivery</h1>
          <p className="text-sm text-gray-600">
            Choisis ton type de compte pour continuer.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Client */}
          <Link
            href="/signup/client"
            className="border rounded-xl p-4 flex flex-col items-center justify-between hover:shadow-md transition"
          >
            <div className="text-lg font-semibold">Client</div>
            <p className="text-xs text-gray-600 text-center mt-2">
              Commander à manger, se faire livrer.
            </p>
          </Link>

          {/* Chauffeur */}
          <Link
            href="/signup/driver"
            className="border rounded-xl p-4 flex flex-col items-center justify-between hover:shadow-md transition"
          >
            <div className="text-lg font-semibold">Chauffeur / Livreur</div>
            <p className="text-xs text-gray-600 text-center mt-2">
              Gagner de l&apos;argent en livrant.
            </p>
          </Link>

          {/* Restaurant */}
          <Link
            href="/signup/restaurant"
            className="border rounded-xl p-4 flex flex-col items-center justify-between hover:shadow-md transition"
          >
            <div className="text-lg font-semibold">Restaurant</div>
            <p className="text-xs text-gray-600 text-center mt-2">
              Recevoir des commandes MMD Delivery.
            </p>
          </Link>
        </div>

        <p className="text-[11px] text-gray-500 text-center">
          Un compte par email. Tu pourras utiliser le même email plus tard dans l&apos;app mobile.
        </p>
      </div>
    </div>
  );
}
