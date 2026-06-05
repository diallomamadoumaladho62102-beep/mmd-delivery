"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";
import { canAccessAdminDashboard } from "@/lib/adminAccess";
import { roleDisplayName } from "@/lib/adminRbac";
import { normalizeUserRole, type UserRole } from "@/lib/roles";

type Props = {
  children: ReactNode;
  requiredPermission?: import("@/lib/adminRbac").AdminPermission;
};

export default function AdminGate({ children, requiredPermission }: Props) {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;

      if (!uid) {
        if (alive) {
          setDenied(true);
          setLoading(false);
        }
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      const normalized = normalizeUserRole(profile?.role);

      if (!alive) return;

      if (!normalized || !canAccessAdminDashboard(normalized)) {
        setDenied(true);
        setLoading(false);
        return;
      }

      if (requiredPermission) {
        const { hasPermission } = await import("@/lib/adminRbac");
        if (!hasPermission(normalized, requiredPermission)) {
          setDenied(true);
          setLoading(false);
          return;
        }
      }

      setRole(normalized);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [requiredPermission]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500">Chargement espace admin…</div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Accès refusé</div>
          <p className="mt-2 text-sm text-slate-600">
            Cette section est réservée au personnel MMD Delivery autorisé.
          </p>
          <Link
            href="/auth/sign-in"
            className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        Connecté : <span className="font-semibold">{roleDisplayName(role)}</span>
        {" · "}
        <Link href="/admin" className="text-blue-700 underline">
          Control Center
        </Link>
      </div>
      {children}
    </div>
  );
}
