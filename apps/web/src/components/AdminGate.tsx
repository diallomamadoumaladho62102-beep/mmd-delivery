"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CC_BTN_PRIMARY,
  CC_BTN_SECONDARY,
} from "@/components/admin/adminUi";
import {
  resolveBrowserStaffSession,
  waitForBrowserSession,
} from "@/lib/adminBrowserAuth";
import { STAFF_LOGIN_DENIED_MESSAGE } from "@/lib/adminStaffLogin";
import { type AdminPermission } from "@/lib/adminRbac";
import { sessionHasPermission } from "@/lib/adminSessionAccess";
import { supabase } from "@/lib/supabaseBrowser";

type Props = {
  children: ReactNode;
  requiredPermission?: AdminPermission;
};

type GateState = "loading" | "allowed" | "no-session" | "forbidden" | "error";

export default function AdminGate({ children, requiredPermission }: Props) {
  const [state, setState] = useState<GateState>("loading");
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
          return;
        }

        const session = await resolveBrowserStaffSession();
        if (!alive) return;

        if (!session) {
          setErrorMessage(null);
          setState("forbidden");
          return;
        }

        // Founder never sees Accès refusé on admin gates.
        if (
          requiredPermission &&
          !sessionHasPermission(
            { role: session.role, isFounder: session.isFounder },
            requiredPermission
          )
        ) {
          setErrorMessage(null);
          setState("forbidden");
          return;
        }

        setErrorMessage(null);
        setState("allowed");
      } catch (err) {
        if (!alive) return;
        console.error("[AdminGate] evaluate failed", err);
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
      <div className="admin-figma min-h-screen p-6 text-sm text-[var(--cc-muted)]">
        Chargement Control Center…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="admin-figma min-h-screen">
        <div className="mx-auto max-w-xl p-6">
          <div className="cc-card p-6">
            <div className="text-lg font-semibold text-white">
              Control Center indisponible
            </div>
            <p className="mt-2 text-sm text-[var(--cc-muted)]">
              {errorMessage ??
                "La session admin n'a pas pu être vérifiée. Réessaie ou reconnecte-toi."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setState("loading");
                  setErrorMessage(null);
                }}
                className={CC_BTN_SECONDARY}
              >
                Réessayer
              </button>
              <Link href="/admin/login" className={CC_BTN_PRIMARY}>
                Se connecter
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "no-session") {
    return (
      <div className="admin-figma min-h-screen">
        <div className="mx-auto max-w-xl p-6">
          <div className="cc-card p-6">
            <div className="text-lg font-semibold text-white">Connexion requise</div>
            <p className="mt-2 text-sm text-[var(--cc-muted)]">
              Connecte-toi avec ton compte staff MMD Delivery pour accéder au
              Control Center.
            </p>
            <Link
              href="/admin/login"
              className={`mt-4 inline-flex ${CC_BTN_PRIMARY}`}
            >
              Se connecter
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="admin-figma min-h-screen">
        <div className="mx-auto max-w-xl p-6">
          <div className="cc-card p-6">
            <div className="text-lg font-semibold text-white">Accès refusé</div>
            <p className="mt-2 text-sm text-[var(--cc-muted)]">
              {STAFF_LOGIN_DENIED_MESSAGE}
            </p>
            <Link
              href="/admin"
              className="mt-4 inline-block text-sm font-medium text-[var(--cc-gold)] underline"
            >
              Retour au Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
