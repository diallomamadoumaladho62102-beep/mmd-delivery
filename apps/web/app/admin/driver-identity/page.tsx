"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DriverIdentityControlCenter, {
  type IdentityCheckDetail,
  type IdentityCheckListItem,
} from "@/components/admin/DriverIdentityControlCenter";
import { canManageDriverIdentity, canViewDriverIdentity } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import type { IdentityQueueFilterId } from "@/lib/driverIdentityDisplay";
import { supabase } from "@/lib/supabaseBrowser";
import type { UserRole } from "@/lib/roles";

export default function AdminDriverIdentityPage() {
  const [role, setRole] = useState<UserRole>(null);
  const [checks, setChecks] = useState<IdentityCheckListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState<IdentityQueueFilterId>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IdentityCheckDetail | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      setRole((profile?.role as UserRole) ?? null);
    })();
  }, []);

  const canRead = canViewDriverIdentity(role);
  const canManage = canManageDriverIdentity(role);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (queueFilter) qs.set("queue", queueFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await adminFetch(`/api/admin/driver-identity/checks?${qs.toString()}`);
      const body = await res.json();
      setChecks(body.checks ?? []);
    } finally {
      setLoading(false);
    }
  }, [queueFilter, search, statusFilter]);

  useEffect(() => {
    if (canRead) void loadChecks();
  }, [canRead, loadChecks]);

  const loadDetail = useCallback(async (checkId: string) => {
    setSelectedId(checkId);
    const res = await adminFetch(`/api/admin/driver-identity/checks/${checkId}`);
    const body = (await res.json()) as IdentityCheckDetail;
    setDetail(body);
  }, []);

  const review = useCallback(
    async (action: string) => {
      if (!selectedId || !canManage) return;
      setBusy(true);
      try {
        await adminFetch(`/api/admin/driver-identity/checks/${selectedId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, review_notes: reviewNotes }),
        });
        await loadDetail(selectedId);
        await loadChecks();
      } finally {
        setBusy(false);
      }
    },
    [canManage, loadChecks, loadDetail, reviewNotes, selectedId],
  );

  const navigateCheck = useCallback(
    (direction: "prev" | "next") => {
      if (!selectedId || checks.length === 0) return;
      const index = checks.findIndex((item) => item.id === selectedId);
      if (index < 0) return;
      const nextIndex = direction === "prev" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= checks.length) return;
      void loadDetail(checks[nextIndex].id);
    },
    [checks, loadDetail, selectedId],
  );

  const selectedIndex = useMemo(
    () => (selectedId ? checks.findIndex((item) => item.id === selectedId) : -1),
    [checks, selectedId],
  );

  const statuses = useMemo(
    () => [
      "",
      "required",
      "pending",
      "submitted",
      "manual_review",
      "verified",
      "rejected",
      "expired",
    ],
    [],
  );

  if (!canRead) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Vérification identité chauffeur
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Accès refusé.
          </p>
        </div>
      </main>
    );
  }

  return (
    <DriverIdentityControlCenter
      checks={checks}
      loading={loading}
      selectedId={selectedId}
      selectedIndex={selectedIndex}
      detail={detail}
      reviewNotes={reviewNotes}
      busy={busy}
      canManage={canManage}
      statusFilter={statusFilter}
      queueFilter={queueFilter}
      search={search}
      statuses={statuses}
      onStatusFilterChange={setStatusFilter}
      onQueueFilterChange={setQueueFilter}
      onSearchChange={setSearch}
      onFilter={() => void loadChecks()}
      onSelectCheck={(checkId) => void loadDetail(checkId)}
      onNavigateCheck={navigateCheck}
      onReviewNotesChange={setReviewNotes}
      onReview={(action) => void review(action)}
    />
  );
}
