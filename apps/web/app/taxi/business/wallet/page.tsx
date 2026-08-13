"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — Business Wallet UI lives under /business/wallet (Figma Desktop 1280). */
export default function BusinessWalletRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/business/wallet");
  }, [router]);
  return (
    <main className="min-h-screen bg-[#0033CC] px-4 py-10 text-white">
      Redirecting to Business Wallet…
    </main>
  );
}
