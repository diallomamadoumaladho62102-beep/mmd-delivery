"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type Task = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_at: string | null;
  country_code: string | null;
  region: string | null;
  assignee_ids?: string[];
};

type AdminRow = { id: string; full_name: string | null; email: string | null };

const STATUSES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function AdminTasksInner() {
  const searchParams = useSearchParams();
  const presetAssignee = searchParams.get("assignee") ?? "";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingMigration, setPendingMigration] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState(presetAssignee);
  const [statusFilter, setStatusFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tasksRes, adminsRes] = await Promise.all([
        adminFetch("/api/admin/tasks"),
        adminFetch("/api/admin/admins").catch(() => null),
      ]);
      const tasksBody = await tasksRes.json().catch(() => ({}));
      if (!tasksRes.ok || !tasksBody.ok) {
        setTasks([]);
        setError(tasksBody.error ?? "Failed to load tasks");
        setPendingMigration(Boolean(tasksBody.pending_migration));
      } else {
        setTasks(tasksBody.items ?? []);
        setPendingMigration(false);
        setError(null);
      }
      if (adminsRes?.ok) {
        const adminsBody = await adminsRes.json().catch(() => ({}));
        if (adminsBody.ok) setAdmins(adminsBody.items ?? []);
      }
    } catch {
      setTasks([]);
      setError("Connection lost — could not load tasks");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (presetAssignee) setAssigneeId(presetAssignee);
  }, [presetAssignee]);

  const visibleTasks = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter((t) => t.status === statusFilter);
  }, [tasks, statusFilter]);

  const grouped = useMemo(() => {
    return STATUSES.map((status) => ({
      ...status,
      items: visibleTasks.filter((t) => t.status === status.value),
    }));
  }, [visibleTasks]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating || pendingMigration) return;
    setCreating(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          priority,
          due_at: dueAt || null,
          assignee_ids: assigneeId ? [assigneeId] : [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Create failed");
        setPendingMigration(Boolean(body.pending_migration));
        return;
      }
      setTitle("");
      setDescription("");
      setDueAt("");
      await load();
    } catch {
      setError("Connection lost — task was not created");
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Update failed");
        return;
      }
      await load();
    } catch {
      setError("Connection lost — status was not updated");
    } finally {
      setBusyId(null);
    }
  }

  async function reassign(id: string, nextAssignee: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          assignee_ids: nextAssignee ? [nextAssignee] : [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Reassign failed");
        return;
      }
      await load();
    } catch {
      setError("Connection lost — reassignment failed");
    } finally {
      setBusyId(null);
    }
  }

  async function removeTask(id: string) {
    if (busyId) return;
    if (!window.confirm("Delete this task permanently?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Delete failed");
        return;
      }
      await load();
    } catch {
      setError("Connection lost — delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
            Work queue
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Tasks
          </h1>
          <p className="mt-1 text-sm text-[var(--cc-muted)]">
            Assign, track, and close internal Control Center work
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </header>

      {pendingMigration ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Tasks storage is unavailable until migration{" "}
          <code>20260925120000_admin_control_center_tasks.sql</code> is applied.
          Creates and updates are blocked.
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="cc-card grid gap-3 p-5 md:grid-cols-2"
      >
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          disabled={creating || pendingMigration}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm md:col-span-2"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={2}
          disabled={creating || pendingMigration}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm md:col-span-2"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          disabled={creating || pendingMigration}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          disabled={creating || pendingMigration}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          disabled={creating || pendingMigration}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm md:col-span-2"
        >
          <option value="">Unassigned</option>
          {admins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.full_name || admin.email}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--cc-muted)] md:col-span-2">
          Tasks support title, priority, due date, and assignee. Comments and
          attachments are not part of this launch surface.
        </p>
        <button
          type="submit"
          disabled={creating || pendingMigration}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 md:col-span-2"
        >
          {creating ? "Creating…" : "Create task"}
        </button>
      </form>

      {!pendingMigration && tasks.length === 0 && !error ? (
        <div className="cc-card px-5 py-10 text-center text-sm text-[var(--cc-muted)]">
          No tasks yet. Create the first work item above.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {grouped.map((column) => (
          <section key={column.value} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
              {column.label} ({column.items.length})
            </h2>
            <div className="space-y-2">
              {column.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--cc-border)] px-3 py-6 text-center text-xs text-[var(--cc-muted)]">
                  Empty
                </div>
              ) : (
                column.items.map((task) => (
                  <article key={task.id} className="cc-card space-y-2 p-3">
                    <p className="text-sm font-medium text-slate-900">{task.title}</p>
                    <p className="text-xs capitalize text-[var(--cc-muted)]">
                      {task.priority}
                      {task.due_at
                        ? ` · due ${new Date(task.due_at).toLocaleString()}`
                        : ""}
                    </p>
                    <select
                      value={task.status}
                      disabled={busyId === task.id}
                      onChange={(e) => void setStatus(task.id, e.target.value)}
                      className="w-full rounded-lg border border-[var(--cc-border)] px-2 py-1 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={task.assignee_ids?.[0] ?? ""}
                      disabled={busyId === task.id}
                      onChange={(e) => void reassign(task.id, e.target.value)}
                      className="w-full rounded-lg border border-[var(--cc-border)] px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {admins.map((admin) => (
                        <option key={admin.id} value={admin.id}>
                          {admin.full_name || admin.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void removeTask(task.id)}
                      className="w-full rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function AdminTasksPage() {
  return (
    <AdminGate requiredPermission="hub.access">
      <Suspense
        fallback={<p className="text-sm text-[var(--cc-muted)]">Loading tasks…</p>}
      >
        <AdminTasksInner />
      </Suspense>
    </AdminGate>
  );
}
