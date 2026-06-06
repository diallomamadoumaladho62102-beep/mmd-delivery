"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  accountStatusBlockMessage,
  isAccountActive,
} from "@/lib/accountStatus";
import { supabase } from "@/lib/supabaseBrowser";

type GuardState = "loading" | "allowed" | "blocked" | "no-session";

export function useAccountAccessGuard() {
  const router = useRouter();
  const [state, setState] = useState<GuardState>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        if (!alive) return;
        setState("no-session");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("account_status")
        .eq("id", userId)
        .maybeSingle();

      const status = String(profile?.account_status ?? "active");
      const blockMessage = accountStatusBlockMessage(status);

      if (!isAccountActive(status)) {
        if (!alive) return;
        setMessage(blockMessage);
        setState("blocked");
        await supabase.auth.signOut();
        router.replace("/auth/sign-in");
        return;
      }

      if (!alive) return;
      setState("allowed");
    };

    void run();

    return () => {
      alive = false;
    };
  }, [router]);

  return { state, message };
}
