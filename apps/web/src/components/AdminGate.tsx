"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  resolveBrowserStaffSession,
  waitForBrowserSession,
} from "@/lib/adminBrowserAuth";
import {
  hasPermission,
  roleDisplayName,
  type AdminPermission,
} from "@/lib/adminRbac";
import { supabase } from "@/lib/supabaseBrowser";
import type { UserRole } from "@/lib/roles";

type Props = {
  children: ReactNode;
  requiredPermission?: AdminPermission;
};

type GateState = "loading" | "allowed" | "no-session" | "forbidden";

export default function AdminGate({ children, requiredPermission }: Props) {
  const [state, setState] = useState<GateState>("loading");
  const [role, setRole] = useState<UserRole>(null);

  useEffect(() => {
    let alive = true;

    const evaluate = async () => {
      const token = await waitForBrowserSession();
      if (!alive) return;

      if (!token) {
        setState("no-session");
        setRole(null);
        return;
      }

      const session = await resolveBrowserStaffSession();
      if (!alive) return;

      if (!session) {
        setState("forbidden");
        setRole(null);
        return;
      }

      if (
        requiredPermission &&
        !hasPermission(session.role, requiredPermission)
      ) {
        setState("forbidden");
        setRole(null);
        return;
      }

      setRole(session.role);
      setState("allowed");
    };

    void evaluate();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void evaluate();
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [requiredPermission]);

  if (state === "loading") {
    return (
      <div className="p-6 text-sm text-slate-500">Chargement espace admin…</div>
    );
  }

  if (state === "no-session") {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">
            Connexion requise
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Connecte-toi avec ton compte staff MMD Delivery pour accéder à
            l&apos;espace admin.
          </p>
          <Link
            href="/auth"
            className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Accès refusé</div>
          <p className="mt-2 text-sm text-slate-600">
            Cette section est réservée au personnel MMD Delivery autorisé.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
          >
            Retour au dashboard
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
