"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — Administrators lives at /admin/staff */
export default function AdminAdminsRedirectPage() {
  const { t } = useAdminT();

  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/staff");
  }, [router]);
  return (
    <div className="p-6 text-sm text-[var(--cc-muted)]">
      {t("Redirecting to Administrators…")}
    </div>
  );
}
