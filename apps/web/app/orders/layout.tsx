"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function OrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        // Pages publiques à laisser passer
        const isPublic =
          pathname === "/orders/new" ||
          pathname.startsWith("/orders/demo") ||
          pathname.includes("/orders/new");

        if (isPublic) {
          return;
        }

        const { data } = await supabase.auth.getUser();

        if (!data.user) {
          router.replace("/signup");
          return;
        }
      } finally {
        if (alive) {
          setChecking(false);
        }
      }
    }

    check();

    return () => {
      alive = false;
    };
  }, [router, pathname]);

  if (checking) {
    return <div className="p-6">Chargement…</div>;
  }

  return <>{children}</>;
}
