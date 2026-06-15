import type { ReactNode } from "react";
import AdminGate from "@/components/AdminGate";

export default function AdminSectionLayout({ children }: { children: ReactNode }) {
  return <AdminGate requiredPermission="hub.access">{children}</AdminGate>;
}
