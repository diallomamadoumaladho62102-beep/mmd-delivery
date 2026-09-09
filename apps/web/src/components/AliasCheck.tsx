"use client";

import { useAdminT } from "@/i18n/useAdminT";

export default function AliasCheck() {
  const { t } = useAdminT();

  return <div className="text-xs text-green-600">{t("Alias @/ OK ✅")}</div>;
}

