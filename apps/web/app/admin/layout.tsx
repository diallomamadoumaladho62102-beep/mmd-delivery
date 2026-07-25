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

  return (
    <AdminGate requiredPermission="hub.access">
      <AdminShell>{children}</AdminShell>
    </AdminGate>
  );
}
