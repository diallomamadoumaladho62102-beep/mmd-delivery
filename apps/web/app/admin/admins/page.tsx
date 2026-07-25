"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — Staff & Roles lives at /admin/staff */
export default function AdminAdminsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/staff");
  }, [router]);
  return (
    <div className="p-6 text-sm text-[var(--cc-muted)]">
      Redirecting to Staff & Roles…
    </div>
  );
}
