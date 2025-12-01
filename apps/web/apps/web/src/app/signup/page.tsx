"use client";
export default function SignupIndex() {
  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Créer mon compte</h1>
      <p className="text-gray-600">Choisis le type de compte pour continuer.</p>

      <div className="space-y-2">
        <a href="/signup/client" className="block border rounded-lg p-3 hover:bg-gray-50">
          <div className="font-medium">Client</div>
          <div className="text-sm text-gray-600">Commander et suivre mes livraisons</div>
        </a>
        <a href="/signup/driver" className="block border rounded-lg p-3 hover:bg-gray-50">
          <div className="font-medium">Driver</div>
          <div className="text-sm text-gray-600">Livrer des commandes et être payé</div>
        </a>
        <a href="/signup/restaurant" className="block border rounded-lg p-3 hover:bg-gray-50">
          <div className="font-medium">Restaurant</div>
          <div className="text-sm text-gray-600">Recevoir des commandes de repas</div>
        </a>
      </div>
    </div>
  );
}
