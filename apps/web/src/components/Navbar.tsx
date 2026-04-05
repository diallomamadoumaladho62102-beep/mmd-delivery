"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type User = {
  id: string;
  email?: string;
};

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!error && data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email ?? undefined,
        });
      } else {
        setUser(null);
      }

      setLoading(false);
    }

    load();

    // 🔥 écoute les changements de session (important)
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session?.user) {
        setUser(null);
      } else {
        setUser({
          id: session.user.id,
          email: session.user.email ?? undefined,
        });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    await supabase.auth.signOut();

    // ✅ redirection propre (pas de flash, pas de reload)
    router.replace("/signup");
  }

  return (
    <nav className="w-full border-b bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg">
          MMD Delivery
        </Link>

        {!loading && (
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-gray-600">{user.email}</span>
                <button
                  onClick={logout}
                  className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700"
                >
                  Se déconnecter
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"
              >
                Se connecter
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
