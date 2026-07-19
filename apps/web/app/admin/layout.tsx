"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";

export default function AdminSectionLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  // Hub already has a dense control-center chrome — keep gate only.
  if (pathname === "/admin") {
    return <AdminGate requiredPermission="hub.access">{children}</AdminGate>;
  }

  return (
    <AdminGate requiredPermission="hub.access">
      <AdminShell>{children}</AdminShell>
    </AdminGate>
  );
}
