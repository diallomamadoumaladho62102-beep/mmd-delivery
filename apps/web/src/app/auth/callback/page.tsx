import { Suspense } from "react";
import CallbackClient from "./CallbackClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">Connexion en cours…</main>}>
      <CallbackClient />
    </Suspense>
  );
}