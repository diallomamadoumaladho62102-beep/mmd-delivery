"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";
import {
  MMD_ORG_CHART,
  staffRolesForOrgNode,
  type OrgNode,
} from "@/lib/adminOrgChart";
import { roleDisplayName } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  account_status: string;
  is_founder: boolean;
};

export default function AdminTeamsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);

  useEffect(() => {
    void adminFetch("/api/admin/admins")
      .then((res) => res.json())
      .then((body) => {
        if (body?.ok) setRows(body.items ?? []);
      })
      .catch(() => undefined);
  }, []);

  const byRole = useMemo(() => {
    const map = new Map<string, AdminRow[]>();
    for (const row of rows) {
      const list = map.get(row.role) ?? [];
      list.push(row);
      map.set(row.role, list);
    }
    return map;
  }, [rows]);

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
            Administration
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Teams & Organization
          </h1>
          <p className="mt-1 text-sm text-[var(--cc-muted)]">
            Interactive org chart · click a card to open profile or assign work
          </p>
        </header>

        <div className="overflow-x-auto pb-4">
          <OrgBranch
            node={MMD_ORG_CHART}
            byRole={byRole}
            depth={0}
          />
        </div>
      </div>
    </AdminGate>
  );
}

function OrgBranch({
  node,
  byRole,
  depth,
}: {
  node: OrgNode;
  byRole: Map<string, AdminRow[]>;
  depth: number;
}) {
  const roles = staffRolesForOrgNode(node.roleKey);
  const people =
    node.roleKey === "founder"
      ? Array.from(byRole.values())
          .flat()
          .filter((r) => r.is_founder)
      : roles.flatMap((role) => byRole.get(role) ?? []);

  const lead = people[0] ?? null;
  const headcount = Math.max(people.length, node.children?.length ? 0 : people.length);

  return (
    <div className="inline-flex min-w-full flex-col items-center gap-4 px-2">
      <OrgCard
        title={node.title}
        department={node.department}
        lead={lead}
        headcount={people.length || headcount}
        depth={depth}
      />
      {node.children?.length ? (
        <div className="flex flex-wrap justify-center gap-6 border-t border-[var(--cc-border)] pt-4">
          {node.children.map((child) => (
            <OrgBranch
              key={child.id}
              node={child}
              byRole={byRole}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrgCard({
  title,
  department,
  lead,
  headcount,
  depth,
}: {
  title: string;
  department: string;
  lead: AdminRow | null;
  headcount: number;
  depth: number;
}) {
  const href = lead ? `/admin/staff/${lead.id}` : "/admin/staff";
  return (
    <div
      className="cc-card w-[220px] p-4"
      style={{ marginTop: depth === 0 ? 0 : undefined }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
        {department}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">
          {(lead?.full_name || title).slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">
            {lead?.full_name || "Vacant"}
          </p>
          <p className="truncate text-xs text-[var(--cc-muted)]">
            {lead
              ? roleDisplayName(lead.role as never, { isFounder: lead.is_founder })
              : "Open seat"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-[var(--cc-muted)]">
        <span
          className={
            lead?.account_status === "active"
              ? "text-[var(--cc-success)]"
              : "text-[var(--cc-disabled)]"
          }
        >
          {lead ? (lead.account_status === "active" ? "Online" : "Offline") : "—"}
        </span>
        <span>{headcount} people</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href={href}
          className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
        >
          Profile
        </Link>
        <Link
          href={lead ? `/admin/tasks?assignee=${lead.id}` : "/admin/tasks"}
          className="rounded-lg border border-[var(--cc-border)] px-2 py-1 text-xs font-semibold"
        >
          Task
        </Link>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="cursor-not-allowed rounded-lg border border-[var(--cc-border)] bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-400"
        >
          Message
        </button>
      </div>
    </div>
  );
}
