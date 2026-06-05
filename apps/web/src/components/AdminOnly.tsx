"use client";

import AdminGate from "@/components/AdminGate";

export default function AdminOnly({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminGate>{children}</AdminGate>;
}
