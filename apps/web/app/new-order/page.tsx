"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewOrderPage() {
  const { t } = useAdminT();

  const router = useRouter();
  const [message, setMessage] = useState("Redirecting to secure order flow…");

  useEffect(() => {
    router.replace("/orders/new");
  }, [router]);

  return (
    <main className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold">{t("Legacy order page")}</h1>
      <p className="text-sm text-gray-600 mt-2">{message}</p>
    </main>
  );
}
