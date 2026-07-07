"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  resolveBrowserStaffSession,
  waitForBrowserSession,
} from "@/lib/adminBrowserAuth";
import { STAFF_LOGIN_DENIED_MESSAGE } from "@/lib/adminStaffLogin";
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

type GateState = "loading" | "allowed" | "no-session" | "forbidden" | "error";

export default function AdminGate({ children, requiredPermission }: Props) {
  const [state, setState] = useState<GateState>("loading");
  const [role, setRole] = useState<UserRole>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const evaluate = async () => {
      try {
        const token = await waitForBrowserSession();
        if (!alive) return;

        if (!token) {
          setErrorMessage(null);
          setState("no-session");
          setRole(null);
          return;
        }

        const session = await resolveBrowserStaffSession();
        if (!alive) return;

        if (!session) {
          setErrorMessage(null);
          setState("forbidden");
          setRole(null);
          return;
        }

        if (
          requiredPermission &&
          !hasPermission(session.role, requiredPermission)
        ) {
          setErrorMessage(null);
          setState("forbidden");
          setRole(null);
          return;
        }

        setErrorMessage(null);
        setRole(session.role);
        setState("allowed");
      } catch (err) {
        if (!alive) return;
        console.error("[AdminGate] evaluate failed", err);
        setRole(null);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Impossible de charger l'espace admin."
        );
        setState("error");
      }
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

  if (state === "error") {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">
            Espace admin indisponible
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {errorMessage ??
              "La session admin n'a pas pu être vérifiée. Réessaie ou reconnecte-toi."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setState("loading");
                setErrorMessage(null);
                void resolveBrowserStaffSession().then((session) => {
                  if (session) {
                    setRole(session.role);
                    setState("allowed");
                    return;
                  }
                  setState("no-session");
                });
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Réessayer
            </button>
            <Link
              href="/admin/login"
              className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </div>
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
            href="/admin/login"
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
            {STAFF_LOGIN_DENIED_MESSAGE}
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
