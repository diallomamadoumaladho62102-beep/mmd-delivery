"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import Image from "next/image";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        router.replace("/dashboard");
      } else {
        router.replace("/auth");
      }
    };

    check();
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white">
      
      {/* LOGO */}
      <Image
        src="/brand/mmd-logo.png"
        alt="MMD Delivery Logo"
        width={120}
        height={120}
        priority
      />

      {/* NOM */}
      <h1 className="text-3xl font-bold text-gray-900">
        MMD Delivery
      </h1>

      {/* LOADING */}
      <p className="text-sm text-gray-500">
        Chargement...
      </p>

    </main>
  );
}
