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
import { ADMIN_LOGO } from "@/components/admin/adminUi";

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
    [trimmedEmail]
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
    accessToken: string
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

  const fieldClass =
    "h-14 w-full rounded-2xl border border-white/20 bg-white/10 px-4 text-[17px] text-white outline-none placeholder:text-white/45 focus:ring-2 focus:ring-[#2563eb] disabled:opacity-60";

  return (
    <main className="admin-figma flex min-h-screen items-center justify-center bg-[#0033CC] p-6 sm:p-10">
      <div className="w-full max-w-[480px] rounded-[28px] border border-white/50 bg-white/10 p-8 shadow-[0px_18px_40px_-12px_rgba(0,0,0,0.25)] backdrop-blur-[12px] sm:p-12">
        <div className="flex flex-col items-center gap-3">
          <Image
            src={ADMIN_LOGO}
            alt="MMD Delivery"
            width={48}
            height={48}
            priority
            className="size-12 rounded-[14px] object-contain"
          />
          <p className="text-[28px] font-extrabold text-[#FBBF24]">MMD Control</p>
        </div>

        <div className="mt-6 text-center">
          <h1 className="text-[32px] font-extrabold text-white sm:text-[36px]">
            Staff Sign In
          </h1>
          <p className="mt-2 text-base text-white/70 sm:text-lg">
            Use your staff account to access the Control Center.
          </p>
        </div>

        {isCheckingSession ? (
          <div className="mt-8 rounded-2xl border border-white/15 bg-white/10 px-4 py-6 text-center text-white/80">
            Loading…
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="mb-2 block text-base font-semibold text-white/70"
              >
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoFocus
                placeholder="staff@mmd.delivery"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && state !== "loading") {
                    event.preventDefault();
                    passwordRef.current?.focus();
                  }
                }}
                className={fieldClass}
                disabled={state === "loading"}
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-2 block text-base font-semibold text-white/70"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && state !== "loading") {
                      event.preventDefault();
                      void signInWithPassword();
                    }
                  }}
                  className={`${fieldClass} pr-24`}
                  disabled={state === "loading"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-white/80"
                  disabled={state === "loading"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void signInWithPassword()}
              disabled={state === "loading"}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#2563EB] text-lg font-extrabold text-white shadow-[0px_10px_12px_rgba(37,99,235,0.2)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" ? "Signing in…" : "Sign In"}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={() => void resetPassword()}
                disabled={state === "loading"}
                className="font-medium text-white/80 underline-offset-2 hover:underline disabled:opacity-60"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => setShowMagicLink((value) => !value)}
                disabled={state === "loading"}
                className="font-medium text-white/70 underline-offset-2 hover:underline disabled:opacity-60"
              >
                {showMagicLink ? "Hide magic link" : "Sign in without password"}
              </button>
            </div>

            {showMagicLink ? (
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                <p className="text-sm text-white/70">
                  Receive a login link by email. Staff accounts must already exist.
                </p>
                <button
                  type="button"
                  onClick={() => void sendMagicLink()}
                  disabled={state === "loading"}
                  className="mt-3 w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Send login link
                </button>
              </div>
            ) : null}
          </div>
        )}

        {message ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              state === "error"
                ? "border-red-400/40 bg-red-500/15 text-red-100"
                : state === "success"
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                  : "border-white/15 bg-white/10 text-white/80"
            }`}
          >
            {message}
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs leading-5 text-white/50">
          Staff accounts cannot be created here. Contact a MMD administrator.
        </p>

        <div className="mt-4 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-white/70 underline-offset-2 hover:underline"
          >
            Back to site
          </Link>
        </div>
      </div>
    </main>
  );
}
