"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DriverIdentityControlCenter, {
  type IdentityCheckDetail,
  type IdentityCheckListItem,
  type IdentityMetrics,
  type IdentityOpsStats,
  type IdentityStaffOption,
} from "@/components/admin/DriverIdentityControlCenter";
import { canManageDriverIdentity, canViewDriverIdentity } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import {
  loadIdentityOpsPrefs,
  saveIdentityOpsPrefs,
  type IdentityOpsPrefs,
  type IdentityQueueFilterId,
} from "@/lib/driverIdentityDisplay";
import { isAdmin } from "@/lib/roles";
import { supabase } from "@/lib/supabaseBrowser";
import type { UserRole } from "@/lib/roles";

const AUTO_ADVANCE_ACTIONS = new Set(["approve", "reject", "request_new_photo"]);

export default function AdminDriverIdentityPage() {
  const [role, setRole] = useState<UserRole>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [checks, setChecks] = useState<IdentityCheckListItem[]>([]);
  const [metrics, setMetrics] = useState<IdentityMetrics | null>(null);
  const [stats, setStats] = useState<IdentityOpsStats | null>(null);
  const [staffOptions, setStaffOptions] = useState<IdentityStaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState<IdentityQueueFilterId>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IdentityCheckDetail | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [opsPrefs, setOpsPrefs] = useState<IdentityOpsPrefs>(() => loadIdentityOpsPrefs());
  const previousSelectedId = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const authUserId = data.user?.id ?? null;
      setUserId(authUserId);
      if (!authUserId) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authUserId)
        .maybeSingle();
      setRole((profile?.role as UserRole) ?? null);
    })();
  }, []);

  const canRead = canViewDriverIdentity(role);
  const canManage = canManageDriverIdentity(role);
  const canAssign = isAdmin(role);

  const loadMetrics = useCallback(async () => {
    const res = await adminFetch("/api/admin/driver-identity/metrics");
    const body = await res.json();
    if (body.ok) {
      setMetrics(body.metrics ?? null);
      setStats(body.stats ?? null);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    if (!canAssign) return;
    const res = await adminFetch("/api/admin/driver-identity/staff");
    const body = await res.json();
    if (body.ok) setStaffOptions(body.staff ?? []);
  }, [canAssign]);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (queueFilter === "assigned_to_me") qs.set("assigned", "me");
      else if (queueFilter) qs.set("queue", queueFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await adminFetch(`/api/admin/driver-identity/checks?${qs.toString()}`);
      const body = await res.json();
      setChecks(body.checks ?? []);
    } finally {
      setLoading(false);
    }
  }, [queueFilter, search, statusFilter]);

  useEffect(() => {
    if (!canRead) return;
    void loadChecks();
    void loadMetrics();
    void loadStaff();
  }, [canRead, loadChecks, loadMetrics, loadStaff]);

  const releaseLock = useCallback(async (checkId: string) => {
    await adminFetch(`/api/admin/driver-identity/checks/${checkId}/lock`, {
      method: "DELETE",
    }).catch(() => undefined);
  }, []);

  const loadDetail = useCallback(
    async (checkId: string) => {
      setSelectedId(checkId);
      setLockError(null);

      if (canManage) {
        const lockRes = await adminFetch(
          `/api/admin/driver-identity/checks/${checkId}/lock`,
          { method: "POST" },
        );
        const lockBody = await lockRes.json().catch(() => ({}));
        if (!lockRes.ok) {
          setLockError(
            typeof lockBody.error === "string"
              ? lockBody.error
              : "Impossible d'ouvrir ce dossier.",
          );
        }
      }

      const res = await adminFetch(`/api/admin/driver-identity/checks/${checkId}`);
      const body = (await res.json()) as IdentityCheckDetail;
      if (body.lock_warning) setLockError(body.lock_warning);
      setDetail(body);
    },
    [canManage],
  );

  useEffect(() => {
    const previous = previousSelectedId.current;
    if (previous && previous !== selectedId) {
      void releaseLock(previous);
    }
    previousSelectedId.current = selectedId;
  }, [releaseLock, selectedId]);

  useEffect(() => {
    return () => {
      if (previousSelectedId.current) {
        void releaseLock(previousSelectedId.current);
      }
    };
  }, [releaseLock]);

  const pickNextCheckId = useCallback(
    (currentId: string | null, freshChecks: IdentityCheckListItem[]) => {
      if (freshChecks.length === 0) return null;
      if (!currentId) return freshChecks[0]?.id ?? null;
      const index = freshChecks.findIndex((item) => item.id === currentId);
      if (index >= 0 && index < freshChecks.length - 1) {
        return freshChecks[index + 1].id;
      }
      if (opsPrefs.fastProcessingMode) {
        return freshChecks.find((item) => item.id !== currentId)?.id ?? null;
      }
      return null;
    },
    [opsPrefs.fastProcessingMode],
  );

  const review = useCallback(
    async (action: string) => {
      if (!selectedId || !canManage) return;
      setBusy(true);
      try {
        const res = await adminFetch(`/api/admin/driver-identity/checks/${selectedId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, review_notes: reviewNotes }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLockError(
            typeof body.error === "string" ? body.error : "Action impossible.",
          );
          return;
        }

        await loadMetrics();
        await loadChecks();

        const shouldAdvance =
          opsPrefs.autoAdvanceNext && AUTO_ADVANCE_ACTIONS.has(action);

        if (shouldAdvance || opsPrefs.fastProcessingMode) {
          const resChecks = await adminFetch(
            `/api/admin/driver-identity/checks?${new URLSearchParams({
              ...(statusFilter ? { status: statusFilter } : {}),
              ...(queueFilter === "assigned_to_me"
                ? { assigned: "me" }
                : queueFilter
                  ? { queue: queueFilter }
                  : {}),
              ...(search.trim() ? { q: search.trim() } : {}),
            }).toString()}`,
          );
          const checksBody = await resChecks.json();
          const freshChecks = (checksBody.checks ?? []) as IdentityCheckListItem[];
          setChecks(freshChecks);

          const nextId = pickNextCheckId(selectedId, freshChecks);
          if (nextId) {
            setReviewNotes("");
            await loadDetail(nextId);
            return;
          }
        }

        if (selectedId) await loadDetail(selectedId);
      } finally {
        setBusy(false);
      }
    },
    [
      canManage,
      loadChecks,
      loadDetail,
      loadMetrics,
      opsPrefs.autoAdvanceNext,
      opsPrefs.fastProcessingMode,
      pickNextCheckId,
      queueFilter,
      reviewNotes,
      search,
      selectedId,
      statusFilter,
    ],
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

  const assignCheck = useCallback(
    async (checkId: string, assigneeUserId: string) => {
      const res = await adminFetch(`/api/admin/driver-identity/checks/${checkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee_user_id: assigneeUserId }),
      });
      if (!res.ok) return;
      await loadChecks();
      if (selectedId === checkId) await loadDetail(checkId);
    },
    [loadChecks, loadDetail, selectedId],
  );

  const updateOpsPrefs = useCallback((patch: Partial<IdentityOpsPrefs>) => {
    setOpsPrefs((current) => {
      const next = { ...current, ...patch };
      saveIdentityOpsPrefs(next);
      return next;
    });
  }, []);

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
      canAssign={canAssign}
      userId={userId}
      lockError={lockError}
      metrics={metrics}
      stats={stats}
      staffOptions={staffOptions}
      opsPrefs={opsPrefs}
      statusFilter={statusFilter}
      queueFilter={queueFilter}
      search={search}
      statuses={statuses}
      onStatusFilterChange={setStatusFilter}
      onQueueFilterChange={setQueueFilter}
      onSearchChange={setSearch}
      onFilter={() => {
        void loadChecks();
        void loadMetrics();
      }}
      onSelectCheck={(checkId) => void loadDetail(checkId)}
      onNavigateCheck={navigateCheck}
      onReviewNotesChange={setReviewNotes}
      onReview={(action) => void review(action)}
      onAssignCheck={(checkId, assigneeUserId) => void assignCheck(checkId, assigneeUserId)}
      onOpsPrefsChange={updateOpsPrefs}
    />
  );
}
