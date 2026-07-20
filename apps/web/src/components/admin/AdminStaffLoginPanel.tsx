"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  evaluateStaffLoginAccess,
  isValidStaffLoginEmail,
  mapSupabaseSignInError,
  STAFF_LOGIN_DENIED_MESSAGE,
  type StaffLoginAccessResult,
} from "@/lib/adminStaffLogin";
import { supabase } from "@/lib/supabaseBrowser";

type ViewState = "idle" | "loading" | "success" | "error";

export default function AdminStaffLoginPanel() {
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [state, setState] = useState<ViewState>("idle");
  const [message, setMessage] = useState("");

  const trimmedEmail = useMemo(() => email.trim(), [email]);
  const emailIsValid = useMemo(
    () => isValidStaffLoginEmail(trimmedEmail),
    [trimmedEmail],
  );

  const redirectStaffIfAlreadySignedIn = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;

    const res = await fetch("/api/admin/staff-login-check", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    const access = evaluateStaffLoginAccess({
      role: body.role,
      accountStatus: body.accountStatus,
      isFounder: body.isFounder === true,
    });

    if (access.allowed) {
      router.replace("/admin");
      return true;
    }

    await supabase.auth.signOut();
    return false;
  };

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const redirected = await redirectStaffIfAlreadySignedIn();
      if (!mounted) return;
      if (!redirected) setIsCheckingSession(false);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  const verifyStaffAccess = async (
    accessToken: string,
  ): Promise<StaffLoginAccessResult> => {
    const res = await fetch("/api/admin/staff-login-check", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      if (res.status === 401) {
        return {
          allowed: false as const,
          message: "Session invalide. Reconnecte-toi.",
        };
      }
      if (res.status === 403 && body.error === "Profile not found") {
        return {
          allowed: false as const,
          message: STAFF_LOGIN_DENIED_MESSAGE,
        };
      }
      return {
        allowed: false as const,
        message:
          typeof body.error === "string"
            ? body.error
            : STAFF_LOGIN_DENIED_MESSAGE,
      };
    }

    return evaluateStaffLoginAccess({
      role: body.role,
      accountStatus: body.accountStatus,
      isFounder: body.isFounder === true,
    });
  };

  const signInWithPassword = async () => {
    if (!trimmedEmail) {
      setState("error");
      setMessage("Entrez votre adresse email.");
      return;
    }

    if (!emailIsValid) {
      setState("error");
      setMessage("Entrez une adresse email valide.");
      return;
    }

    if (!password.trim()) {
      setState("error");
      setMessage("Entrez votre mot de passe.");
      return;
    }

    setState("loading");
    setMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      setState("error");
      setMessage(mapSupabaseSignInError(error.message));
      return;
    }

    const token = data.session?.access_token;
    if (!token) {
      setState("error");
      setMessage("Connexion impossible. Réessayez.");
      return;
    }

    const access = await verifyStaffAccess(token);
    if (access.allowed === false) {
      await supabase.auth.signOut();
      setState("error");
      setMessage(access.message);
      return;
    }

    setState("success");
    setMessage("Connexion réussie. Redirection…");
    router.replace("/admin");
  };

  const sendMagicLink = async () => {
    if (!trimmedEmail) {
      setState("error");
      setMessage("Entrez votre adresse email.");
      return;
    }

    if (!emailIsValid) {
      setState("error");
      setMessage("Entrez une adresse email valide.");
      return;
    }

    setState("loading");
    setMessage("");

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent("/admin")}`
        : undefined;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (error) {
      setState("error");
      setMessage(mapSupabaseSignInError(error.message));
      return;
    }

    setState("success");
    setMessage("Lien de connexion envoyé. Vérifiez votre boîte email.");
  };

  const resetPassword = async () => {
    if (!trimmedEmail) {
      setState("error");
      setMessage("Entrez votre adresse email pour réinitialiser le mot de passe.");
      return;
    }

    if (!emailIsValid) {
      setState("error");
      setMessage("Entrez une adresse email valide.");
      return;
    }

    setState("loading");
    setMessage("");

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent("/admin/login")}`
        : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      setState("error");
      setMessage(mapSupabaseSignInError(error.message));
      return;
    }

    setState("success");
    setMessage("Email de réinitialisation envoyé. Vérifiez votre boîte email.");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-50 px-4 py-6 md:px-6 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl md:min-h-[640px] md:grid-cols-2">
          <section className="flex flex-col justify-center bg-gray-900 px-6 py-8 text-white md:px-10 md:py-12">
            <div className="mb-6">
              <Image
                src="/brand/mmd-logo.png"
                alt="MMD Delivery Logo"
                width={84}
                height={84}
                priority
                className="h-20 w-20 rounded-xl object-contain"
              />
            </div>

            <h1 className="text-2xl font-bold leading-tight md:text-4xl">
              Administration MMD Delivery
            </h1>

            <p className="mt-4 max-w-md text-sm leading-6 text-gray-300 md:text-base">
              Espace réservé au personnel autorisé : admin, ops, support, finance
              et review.
            </p>

            <div className="mt-8 space-y-3 text-sm text-gray-300 md:text-base">
              <div>Supervision des opérations</div>
              <div>Paiements et conformité</div>
              <div>Support et modération</div>
            </div>
          </section>

          <section className="flex items-center justify-center px-6 py-8 md:px-10 md:py-12">
            <div className="w-full max-w-md">
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 md:text-3xl">
                  Connexion staff
                </h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Connectez-vous avec votre email et votre mot de passe staff.
                </p>
              </div>

              {isCheckingSession ? (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  Vérification de la session…
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="admin-email"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Email
                    </label>
                    <input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      autoFocus
                      placeholder="staff@mmddelivery.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && state !== "loading") {
                          event.preventDefault();
                          passwordRef.current?.focus();
                        }
                      }}
                      className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
                      disabled={state === "loading"}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="admin-password"
                      className="mb-2 block text-sm font-medium text-gray-700"
                    >
                      Mot de passe
                    </label>
                    <div className="relative">
                      <input
                        id="admin-password"
                        ref={passwordRef}
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Votre mot de passe"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && state !== "loading") {
                            event.preventDefault();
                            void signInWithPassword();
                          }
                        }}
                        className="w-full rounded-2xl border border-gray-300 px-4 py-3 pr-24 text-sm text-gray-900 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
                        disabled={state === "loading"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700"
                        disabled={state === "loading"}
                      >
                        {showPassword ? "Masquer" : "Afficher"}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void signInWithPassword()}
                    disabled={state === "loading"}
                    className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {state === "loading" ? "Connexion…" : "Se connecter"}
                  </button>

                  <div className="flex items-center justify-between gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => void resetPassword()}
                      disabled={state === "loading"}
                      className="font-medium text-blue-700 underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      Mot de passe oublié ?
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMagicLink((value) => !value)}
                      disabled={state === "loading"}
                      className="font-medium text-gray-600 underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      {showMagicLink
                        ? "Masquer connexion sans mot de passe"
                        : "Connexion sans mot de passe"}
                    </button>
                  </div>

                  {showMagicLink ? (
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <p className="text-sm text-gray-600">
                        Recevez un lien de connexion par email. Réservé aux
                        comptes staff déjà créés par un administrateur.
                      </p>
                      <button
                        type="button"
                        onClick={() => void sendMagicLink()}
                        disabled={state === "loading"}
                        className="mt-3 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Envoyer le lien de connexion
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {message ? (
                <div
                  className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                    state === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : state === "success"
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-gray-200 bg-gray-50 text-gray-700"
                  }`}
                >
                  {message}
                </div>
              ) : null}

              <p className="mt-6 text-xs leading-5 text-gray-500">
                Les comptes staff ne peuvent pas être créés depuis cette page.
                Contactez un administrateur MMD Delivery si vous avez besoin
                d&apos;un accès.
              </p>

              <Link
                href="/"
                className="mt-4 inline-block text-sm font-medium text-gray-600 underline-offset-2 hover:underline"
              >
                Retour au site
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
