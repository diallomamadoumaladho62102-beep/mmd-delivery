"use client";

import type { AdminDriverListItem, DriverActionStatus, DriverReviewStatus } from "@/lib/adminDriverDisplay";
import DriverCardSkeleton from "./DriverCardSkeleton";
import DriverOpsCard, { type DriverProfileDraft } from "./DriverOpsCard";

/**
 * Presentational list shell — ready for future selection / infinite scroll props.
 */
export default function DriversList({
  items,
  loading,
  canManage,
  expandedId,
  updatingUserId,
  updatingDocumentId,
  noteDrafts,
  profileDrafts,
  documentStatusDrafts,
  documentNoteDrafts,
  onToggleExpand,
  onStatusAction,
  onNoteChange,
  onProfileChange,
  onSaveProfile,
  onDocumentStatusChange,
  onDocumentNoteChange,
  onSaveDocument,
  onDeleteDocument,
  hasMore = false,
  onLoadMore,
  selectedIds,
}: {
  items: AdminDriverListItem[];
  loading: boolean;
  canManage: boolean;
  expandedId: string | null;
  updatingUserId: string | null;
  updatingDocumentId: string | null;
  noteDrafts: Record<string, string>;
  profileDrafts: Record<string, DriverProfileDraft>;
  documentStatusDrafts: Record<string, DriverReviewStatus>;
  documentNoteDrafts: Record<string, string>;
  onToggleExpand: (userId: string) => void;
  onStatusAction: (userId: string, status: DriverActionStatus) => void;
  onNoteChange: (userId: string, value: string) => void;
  onProfileChange: (userId: string, patch: Partial<DriverProfileDraft>) => void;
  onSaveProfile: (userId: string) => void;
  onDocumentStatusChange: (docId: string, status: DriverReviewStatus) => void;
  onDocumentNoteChange: (docId: string, note: string) => void;
  onSaveDocument: (userId: string, docId: string) => void;
  onDeleteDocument: (userId: string, docId: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  selectedIds?: Set<string>;
}) {
  void selectedIds;

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <DriverCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-800">No drivers match</p>
        <p className="mt-1 text-sm text-slate-500">Try clearing filters or refreshing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((driver) => (
          <DriverOpsCard
            key={driver.user_id}
            driver={driver}
            canManage={canManage}
            busy={updatingUserId === driver.user_id}
            expanded={expandedId === driver.user_id}
            onToggleExpand={() => onToggleExpand(driver.user_id)}
            onStatusAction={(status) => onStatusAction(driver.user_id, status)}
            noteDraft={noteDrafts[driver.user_id] ?? ""}
            onNoteChange={(value) => onNoteChange(driver.user_id, value)}
            profileDraft={profileDrafts[driver.user_id] ?? null}
            onProfileChange={(patch) => onProfileChange(driver.user_id, patch)}
            onSaveProfile={() => onSaveProfile(driver.user_id)}
            documentStatusDrafts={documentStatusDrafts}
            documentNoteDrafts={documentNoteDrafts}
            onDocumentStatusChange={onDocumentStatusChange}
            onDocumentNoteChange={onDocumentNoteChange}
            onSaveDocument={(docId) => onSaveDocument(driver.user_id, docId)}
            onDeleteDocument={(docId) => onDeleteDocument(driver.user_id, docId)}
            updatingDocumentId={updatingDocumentId}
          />
        ))}
      </div>
      {hasMore && onLoadMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
