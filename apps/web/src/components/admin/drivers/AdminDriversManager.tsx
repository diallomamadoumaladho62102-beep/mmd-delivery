"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { canReviewDrivers, canViewDrivers } from "@/lib/adminAccess";
import { adminFetch } from "@/lib/adminBrowserAuth";
import {
  DEFAULT_DRIVER_FILTERS,
  computeMissingRequirementsForRow,
  driverFiltersToSearchParams,
  filterDrivers,
  normalizeVehicleType,
  parseDriverFiltersFromSearchParams,
  sortDriversOps,
  type AdminDriverListItem,
  type DriverActionStatus,
  type DriverReviewStatus,
} from "@/lib/adminDriverDisplay";
import { normalizeUserRole } from "@/lib/roles";
import { supabase } from "@/lib/supabaseBrowser";
import DriversList from "./DriversList";
import DriversToolbar from "./DriversToolbar";
import type { DriverProfileDraft } from "./DriverOpsCard";

function buildProfileDraft(row: AdminDriverListItem): DriverProfileDraft {
  return {
    full_name: row.full_name ?? "",
    phone: row.phone ?? "",
    emergency_phone: row.emergency_phone ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip_code: row.zip_code ?? "",
    date_of_birth: row.date_of_birth ?? "",
    transport_mode:
      row.transport_mode === "bike" ||
      row.transport_mode === "moto" ||
      row.transport_mode === "car"
        ? row.transport_mode
        : "car",
    vehicle_brand: row.vehicle_brand ?? "",
    vehicle_model: row.vehicle_model ?? "",
    vehicle_year: row.vehicle_year == null ? "" : String(row.vehicle_year),
    vehicle_color: row.vehicle_color ?? "",
    plate_number: row.plate_number ?? "",
    license_number: row.license_number ?? "",
    license_expiry: row.license_expiry ?? "",
  };
}

export default function AdminDriversManager() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [items, setItems] = useState<AdminDriverListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [staffRole, setStaffRole] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [profileDrafts, setProfileDrafts] = useState<Record<string, DriverProfileDraft>>({});
  const [documentStatusDrafts, setDocumentStatusDrafts] = useState<
    Record<string, DriverReviewStatus>
  >({});
  const [documentNoteDrafts, setDocumentNoteDrafts] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(false);

  const filters = useMemo(
    () => parseDriverFiltersFromSearchParams(searchParams),
    [searchParams]
  );

  const canManage = canReviewDrivers(normalizeUserRole(staffRole));

  const syncFilters = useCallback(
    (next: typeof filters) => {
      const qs = driverFiltersToSearchParams(next).toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router]
  );

  const loadDrivers = useCallback(async () => {
    const res = await adminFetch("/api/admin/drivers?limit=200");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? "Failed to load drivers");
    }
    setHasMore(Boolean(body.page?.hasMore));
    return (body.items ?? []) as AdminDriverListItem[];
  }, []);

  const hydrateDrafts = useCallback((rows: AdminDriverListItem[]) => {
    const notes: Record<string, string> = {};
    const profiles: Record<string, DriverProfileDraft> = {};
    const docStatus: Record<string, DriverReviewStatus> = {};
    const docNotes: Record<string, string> = {};
    for (const row of rows) {
      notes[row.user_id] = "";
      profiles[row.user_id] = buildProfileDraft(row);
      for (const doc of row.documents) {
        docStatus[doc.id] = doc.status as DriverReviewStatus;
        docNotes[doc.id] = doc.review_notes ?? "";
      }
    }
    setNoteDrafts(notes);
    setProfileDrafts(profiles);
    setDocumentStatusDrafts(docStatus);
    setDocumentNoteDrafts(docNotes);
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") setLoading(true);
        else setRefreshing(true);
        setError(null);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setAuthChecked(true);
          setAllowed(false);
          router.push("/admin/login");
          return;
        }
        const { data: me } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        const role = me?.role ?? null;
        setStaffRole(role);
        setAuthChecked(true);
        if (!canViewDrivers(normalizeUserRole(role))) {
          setAllowed(false);
          setError("Accès réservé aux administrateurs.");
          return;
        }
        setAllowed(true);
        const rows = await loadDrivers();
        setItems(rows);
        hydrateDrafts(rows);

        const focus = searchParams.get("focus");
        if (focus) {
          setExpandedId(focus);
          window.setTimeout(() => {
            document.getElementById(`driver-${focus}`)?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }, 100);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [hydrateDrafts, loadDrivers, router, searchParams]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  const visible = useMemo(
    () => sortDriversOps(filterDrivers(items, filters)),
    [items, filters]
  );

  const kpis = useMemo(() => {
    const count = (pred: (r: AdminDriverListItem) => boolean) =>
      items.filter(pred).length;
    return {
      total: items.length,
      pending: count((r) => r.status === "pending" || r.status === "incomplete"),
      approved: count((r) => r.status === "approved"),
      rejected: count((r) => r.status === "rejected"),
      suspended: count((r) => r.status === "suspended"),
      disabled: count((r) => r.status === "disabled"),
      incompleteDocs: count((r) => r.computed_missing_requirements.length > 0),
      online: count((r) => r.is_online),
    };
  }, [items]);

  const cityOptions = useMemo(
    () =>
      [...new Set(items.map((r) => r.city).filter(Boolean) as string[])].sort(),
    [items]
  );
  const stateOptions = useMemo(
    () =>
      [...new Set(items.map((r) => r.state).filter(Boolean) as string[])].sort(),
    [items]
  );

  async function updateDriverStatus(userId: string, newStatus: DriverActionStatus) {
    setUpdatingUserId(userId);
    setError(null);
    setOk(null);
    try {
      const target = items.find((r) => r.user_id === userId);
      if (!target) throw new Error("Driver not found");
      if (
        newStatus === "approved" &&
        target.computed_missing_requirements.length > 0
      ) {
        setError(
          "Impossible d’approuver ce chauffeur : il manque encore des informations ou documents obligatoires."
        );
        return;
      }
      const res = await adminFetch("/api/admin/drivers/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          status: newStatus,
          reviewNotes: (noteDrafts[userId] ?? "").trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Update failed");

      setOk(json.message || `Driver marked ${newStatus}`);
      setItems((prev) =>
        sortDriversOps(
          prev.map((r) => {
            if (r.user_id !== userId) return r;
            const documents =
              newStatus === "approved" || newStatus === "rejected"
                ? r.documents.map((d) => ({
                    ...d,
                    status: newStatus,
                    reviewed_at: json.reviewedAt ?? new Date().toISOString(),
                  }))
                : r.documents;
            const missing = computeMissingRequirementsForRow({
              transport_mode: r.transport_mode,
              full_name: r.full_name,
              phone: r.phone,
              emergency_phone: r.emergency_phone,
              address: r.address,
              city: r.city,
              state: r.state,
              zip_code: r.zip_code,
              date_of_birth: r.date_of_birth,
              vehicle_brand: r.vehicle_brand,
              vehicle_model: r.vehicle_model,
              vehicle_year: r.vehicle_year,
              vehicle_color: r.vehicle_color,
              plate_number: r.plate_number,
              license_number: r.license_number,
              license_expiry: r.license_expiry,
              documents,
            });
            return {
              ...r,
              status: newStatus,
              is_online: typeof json.isOnline === "boolean" ? json.isOnline : false,
              documents,
              computed_missing_requirements: Array.isArray(json.missingRequirements)
                ? json.missingRequirements
                : missing,
              documents_required:
                typeof json.documentsRequired === "boolean"
                  ? json.documentsRequired
                  : missing.length > 0,
            };
          })
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function saveProfile(userId: string) {
    setUpdatingUserId(userId);
    setError(null);
    setOk(null);
    try {
      const draft = profileDrafts[userId];
      if (!draft) throw new Error("Profile draft missing");
      const res = await adminFetch("/api/admin/drivers/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, profile: draft }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Profile update failed");
      setOk(json.message || "Profile saved");
      setItems((prev) =>
        prev.map((row) => {
          if (row.user_id !== userId) return row;
          const vehicleYear = draft.vehicle_year.trim()
            ? Number(draft.vehicle_year.trim())
            : null;
          const updated = {
            ...row,
            full_name: draft.full_name.trim() || null,
            phone: draft.phone.trim() || null,
            emergency_phone: draft.emergency_phone.trim() || null,
            address: draft.address.trim() || null,
            city: draft.city.trim() || null,
            state: draft.state.trim().toUpperCase() || null,
            zip_code: draft.zip_code.trim() || null,
            date_of_birth: draft.date_of_birth.trim() || null,
            transport_mode: normalizeVehicleType(draft.transport_mode),
            vehicle_brand: draft.vehicle_brand.trim() || null,
            vehicle_model: draft.vehicle_model.trim() || null,
            vehicle_year: Number.isFinite(vehicleYear) ? vehicleYear : null,
            vehicle_color: draft.vehicle_color.trim() || null,
            plate_number: draft.plate_number.trim().toUpperCase() || null,
            license_number: draft.license_number.trim().toUpperCase() || null,
            license_expiry: draft.license_expiry.trim() || null,
          };
          const missing = computeMissingRequirementsForRow({
            ...updated,
            documents: updated.documents,
          });
          return { ...updated, computed_missing_requirements: missing };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profile update failed");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function saveDocument(userId: string, documentId: string) {
    setUpdatingDocumentId(documentId);
    setError(null);
    setOk(null);
    try {
      const res = await adminFetch("/api/admin/drivers/update-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          documentId,
          status: documentStatusDrafts[documentId],
          reviewNotes: documentNoteDrafts[documentId] ?? "",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Document update failed");
      setOk("Document updated");
      setItems((prev) =>
        prev.map((row) => {
          if (row.user_id !== userId) return row;
          const documents = row.documents.map((d) =>
            d.id === documentId
              ? {
                  ...d,
                  status: documentStatusDrafts[documentId] ?? d.status,
                  review_notes: documentNoteDrafts[documentId] ?? d.review_notes,
                }
              : d
          );
          return {
            ...row,
            documents,
            computed_missing_requirements: computeMissingRequirementsForRow({
              ...row,
              documents,
            }),
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document update failed");
    } finally {
      setUpdatingDocumentId(null);
    }
  }

  async function deleteDocument(userId: string, documentId: string) {
    if (!window.confirm("Delete this document record?")) return;
    setUpdatingDocumentId(documentId);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/drivers/update-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, documentId, deleteDocument: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Delete failed");
      setOk("Document deleted");
      setItems((prev) =>
        prev.map((row) => {
          if (row.user_id !== userId) return row;
          const documents = row.documents.filter((d) => d.id !== documentId);
          return {
            ...row,
            documents,
            computed_missing_requirements: computeMissingRequirementsForRow({
              ...row,
              documents,
            }),
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setUpdatingDocumentId(null);
    }
  }

  if (authChecked && !allowed) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || "Access denied"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            MMD Delivery · Driver Operations Center
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
            Drivers
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Prioritized ops view: identity, documents, vehicle, and status-aware actions.
            Approval rules are unchanged.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPage("refresh")}
          disabled={refreshing || loading}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {(
          [
            ["Total", kpis.total],
            ["Pending", kpis.pending],
            ["Approved", kpis.approved],
            ["Rejected", kpis.rejected],
            ["Suspended", kpis.suspended],
            ["Disabled", kpis.disabled],
            ["Incomplete", kpis.incompleteDocs],
            ["Online", kpis.online],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
          >
            <div className="text-[11px] font-medium text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {ok}
        </div>
      ) : null}

      <DriversToolbar
        filters={filters}
        onChange={(patch) => syncFilters({ ...filters, ...patch })}
        onReset={() => syncFilters({ ...DEFAULT_DRIVER_FILTERS })}
        cityOptions={cityOptions}
        stateOptions={stateOptions}
        resultCount={visible.length}
        totalCount={items.length}
      />

      <div className={isPending ? "opacity-80" : ""}>
        <DriversList
          items={visible}
          loading={loading}
          canManage={canManage}
          expandedId={expandedId}
          updatingUserId={updatingUserId}
          updatingDocumentId={updatingDocumentId}
          noteDrafts={noteDrafts}
          profileDrafts={profileDrafts}
          documentStatusDrafts={documentStatusDrafts}
          documentNoteDrafts={documentNoteDrafts}
          onToggleExpand={(id) =>
            setExpandedId((prev) => (prev === id ? null : id))
          }
          onStatusAction={(userId, status) => void updateDriverStatus(userId, status)}
          onNoteChange={(userId, value) =>
            setNoteDrafts((prev) => ({ ...prev, [userId]: value }))
          }
          onProfileChange={(userId, patch) =>
            setProfileDrafts((prev) => ({
              ...prev,
              [userId]: { ...prev[userId]!, ...patch },
            }))
          }
          onSaveProfile={(userId) => void saveProfile(userId)}
          onDocumentStatusChange={(docId, status) =>
            setDocumentStatusDrafts((prev) => ({ ...prev, [docId]: status }))
          }
          onDocumentNoteChange={(docId, note) =>
            setDocumentNoteDrafts((prev) => ({ ...prev, [docId]: note }))
          }
          onSaveDocument={(userId, docId) => void saveDocument(userId, docId)}
          onDeleteDocument={(userId, docId) => void deleteDocument(userId, docId)}
          hasMore={hasMore}
          onLoadMore={undefined}
        />
      </div>
    </div>
  );
}
