"use client";

import { memo, useState } from "react";
import Image from "next/image";
import {
  driverStatusBadge,
  onlineBadge,
  partyDisplayName,
  type AdminDriverListItem,
  type DriverActionStatus,
  type DriverReviewStatus,
  type VehicleType,
} from "@/lib/adminDriverDisplay";
import DriverActionsBar from "./DriverActionsBar";
import DriverAvatar from "./DriverAvatar";
import DriverBadge from "./DriverBadge";
import DriverDocBadges from "./DriverDocBadges";
import DriverStatusStepper from "./DriverStatusStepper";

export type DriverProfileDraft = {
  full_name: string;
  phone: string;
  emergency_phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  date_of_birth: string;
  transport_mode: Exclude<VehicleType, "other">;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_year: string;
  vehicle_color: string;
  plate_number: string;
  license_number: string;
  license_expiry: string;
};

function DriverOpsCard({
  driver,
  canManage,
  busy,
  expanded,
  onToggleExpand,
  onStatusAction,
  noteDraft,
  onNoteChange,
  profileDraft,
  onProfileChange,
  onSaveProfile,
  documentStatusDrafts,
  documentNoteDrafts,
  onDocumentStatusChange,
  onDocumentNoteChange,
  onSaveDocument,
  onDeleteDocument,
  updatingDocumentId,
}: {
  driver: AdminDriverListItem;
  canManage: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusAction: (status: DriverActionStatus) => void;
  noteDraft: string;
  onNoteChange: (value: string) => void;
  profileDraft: DriverProfileDraft | null;
  onProfileChange: (patch: Partial<DriverProfileDraft>) => void;
  onSaveProfile: () => void;
  documentStatusDrafts: Record<string, DriverReviewStatus>;
  documentNoteDrafts: Record<string, string>;
  onDocumentStatusChange: (docId: string, status: DriverReviewStatus) => void;
  onDocumentNoteChange: (docId: string, note: string) => void;
  onSaveDocument: (docId: string) => void;
  onDeleteDocument: (docId: string) => void;
  updatingDocumentId: string | null;
}) {
  const name = partyDisplayName(driver.full_name, driver.email);
  const status = driverStatusBadge(driver.status);
  const online = onlineBadge(driver.is_online);
  const joined = driver.created_at
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
        new Date(driver.created_at)
      )
    : null;

  return (
    <article
      id={`driver-${driver.user_id}`}
      className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <DriverAvatar name={name} src={driver.photo_url} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900">{name}</h2>
            <DriverBadge label={status.label} tone={status.tone} />
            <DriverBadge label={online.label} tone={online.tone} />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {driver.transport_mode}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500" title={driver.email ?? undefined}>
            {driver.email || "No email"}
          </p>
          {driver.phone ? (
            <p className="truncate text-xs text-slate-500">{driver.phone}</p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            {[driver.city, driver.state].filter(Boolean).join(", ") || "No location"}
            {joined ? ` · Joined ${joined}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
          <span>Completeness</span>
          <span className="font-semibold text-slate-900">{driver.completeness_percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-orange-500"
            style={{ width: `${driver.completeness_percent}%` }}
          />
        </div>
        {driver.computed_missing_requirements.length > 0 ? (
          <p className="mt-1 text-[11px] text-amber-700">
            Missing: {driver.computed_missing_requirements.slice(0, 4).join(", ")}
            {driver.computed_missing_requirements.length > 4
              ? ` +${driver.computed_missing_requirements.length - 4}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <div className="relative h-20 w-full overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 sm:h-24">
          {driver.vehicle?.photo_url ? (
            <Image
              src={driver.vehicle.photo_url}
              alt=""
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-slate-400">
              No vehicle photo
            </div>
          )}
        </div>
        <div className="text-xs text-slate-600">
          <div className="font-medium text-slate-900">
            {[driver.vehicle?.make || driver.vehicle_brand, driver.vehicle?.model || driver.vehicle_model]
              .filter(Boolean)
              .join(" ") || "Vehicle"}
          </div>
          <div>
            {[
              driver.vehicle?.year || driver.vehicle_year,
              driver.vehicle?.color || driver.vehicle_color,
              driver.vehicle?.plate || driver.plate_number,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <DriverDocBadges driver={driver} />
      </div>

      {(driver.total_deliveries != null ||
        driver.taxi_completed_rides != null ||
        driver.rating != null ||
        driver.acceptance_rate != null) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {driver.total_deliveries != null ? (
            <span>{driver.total_deliveries} deliveries</span>
          ) : null}
          {driver.taxi_completed_rides != null ? (
            <span>{driver.taxi_completed_rides} taxi rides</span>
          ) : null}
          {driver.rating != null ? (
            <span>
              ★ {driver.rating.toFixed(1)}
              {driver.rating_count != null ? ` (${driver.rating_count})` : ""}
            </span>
          ) : null}
          {driver.acceptance_rate != null ? (
            <span>Accept {Math.round(driver.acceptance_rate)}%</span>
          ) : null}
          {driver.cancellation_rate != null ? (
            <span>Cancel {Math.round(driver.cancellation_rate)}%</span>
          ) : null}
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <DriverStatusStepper driver={driver} />
      </div>

      <div className="mt-4 space-y-3">
        {canManage ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Review note
            </label>
            <input
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
              value={noteDraft}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Optional note for approve / reject…"
            />
          </div>
        ) : null}
        <DriverActionsBar
          driver={driver}
          canManage={canManage}
          busy={busy}
          onStatusAction={onStatusAction}
          onView={onToggleExpand}
        />
      </div>

      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="mt-3 text-left text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
      >
        {expanded ? "Hide dossier" : "Open dossier (profile & documents)"}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {profileDraft && canManage ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Edit profile</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["full_name", "Full name"],
                    ["phone", "Phone"],
                    ["emergency_phone", "Emergency phone"],
                    ["city", "City"],
                    ["state", "State"],
                    ["plate_number", "Plate"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs text-slate-600">
                    {label}
                    <input
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 text-sm"
                      value={profileDraft[key]}
                      onChange={(e) => onProfileChange({ [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onSaveProfile}
                className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-50"
              >
                Save profile
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
            {driver.documents.length === 0 ? (
              <p className="text-xs text-slate-500">No documents uploaded.</p>
            ) : (
              driver.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{doc.doc_type}</span>
                    <DriverBadge
                      label={String(doc.status)}
                      tone={
                        doc.status === "approved"
                          ? "green"
                          : doc.status === "rejected"
                            ? "red"
                            : doc.status === "pending"
                              ? "yellow"
                              : "orange"
                      }
                    />
                  </div>
                  {doc.signed_url ? (
                    <a
                      href={doc.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-blue-600 underline"
                    >
                      Open file
                    </a>
                  ) : null}
                  {canManage ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select
                        className="h-10 rounded-lg border border-slate-300 px-2"
                        value={documentStatusDrafts[doc.id] ?? doc.status}
                        onChange={(e) =>
                          onDocumentStatusChange(
                            doc.id,
                            e.target.value as DriverReviewStatus
                          )
                        }
                      >
                        <option value="pending">pending</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                        <option value="incomplete">incomplete</option>
                      </select>
                      <input
                        className="h-10 min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2"
                        value={documentNoteDrafts[doc.id] ?? doc.review_notes ?? ""}
                        onChange={(e) => onDocumentNoteChange(doc.id, e.target.value)}
                        placeholder="Note"
                      />
                      <button
                        type="button"
                        disabled={updatingDocumentId === doc.id}
                        onClick={() => onSaveDocument(doc.id)}
                        className="h-10 rounded-lg border border-slate-300 px-2 font-medium"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={updatingDocumentId === doc.id}
                        onClick={() => onDeleteDocument(doc.id)}
                        className="h-10 rounded-lg border border-red-300 px-2 font-medium text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default memo(DriverOpsCard);
