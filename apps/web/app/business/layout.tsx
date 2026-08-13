"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { BusinessShell } from "@/components/business/BusinessShell";

function initialsFrom(email?: string | null, name?: string | null) {
  const fromName = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  if (fromName) return fromName;
  const local = String(email ?? "").split("@")[0] ?? "";
  return local.slice(0, 2) || "MM";
}

export default function BusinessLayout({ children }: { children: ReactNode }) {
  const [initials, setInitials] = useState("MM");

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      const meta = user.user_metadata ?? {};
      setInitials(
        initialsFrom(
          user.email,
          String(meta.full_name ?? meta.name ?? "")
        )
      );
    });
  }, []);

  return <BusinessShell avatarInitials={initials}>{children}</BusinessShell>;
}
