import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
  type AdminSession,
} from "@/lib/adminServer";
import {
  canCreateConfidential,
  canDeleteTask,
  canMutateTask,
  canViewTask,
  isFounderOrSuperAdmin,
  sanitizeTaskText,
  type AdminTaskRow,
} from "@/lib/adminTasksAccess";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

const STATUSES = [
  "todo",
  "in_progress",
  "waiting",
  "blocked",
  "done",
  "cancelled",
] as const;

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isMissingTableError(message: string): boolean {
  return (
    message.includes("admin_control_tasks") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

async function loadAssignees(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  taskIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!taskIds.length) return map;
  const { data: rows } = await supabase
    .from("admin_control_task_assignees")
    .select("task_id, admin_id")
    .in("task_id", taskIds);
  for (const row of rows ?? []) {
    const list = map.get(String(row.task_id)) ?? [];
    list.push(String(row.admin_id));
    map.set(String(row.task_id), list);
  }
  return map;
}

function attachAssignees(
  tasks: AdminTaskRow[],
  assignees: Map<string, string[]>
): AdminTaskRow[] {
  return tasks.map((task) => ({
    ...task,
    assignee_ids: assignees.get(task.id) ?? [],
  }));
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
      : 100;

    const { data: tasks, error } = await supabase
      .from("admin_control_tasks")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingTableError(error.message)) {
        return json({ ok: false, error: "Tasks migration not applied", pending_migration: true }, 503);
      }
      return json({ ok: false, error: error.message }, 500);
    }

    const assignees = await loadAssignees(
      supabase,
      (tasks ?? []).map((t) => String(t.id))
    );
    const items = attachAssignees((tasks ?? []) as AdminTaskRow[], assignees).filter(
      (task) => canViewTask(session, task)
    );

    return json({ ok: true, items, total: items.length });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const title = sanitizeTaskText(body.title, 200);
    if (!title) return json({ ok: false, error: "title required" }, 400);

    const privacy = String(body.privacy ?? "internal");
    if (privacy === "confidential" && !canCreateConfidential(session)) {
      return json({ ok: false, error: "Forbidden confidential task" }, 403);
    }

    const priority = (PRIORITIES as readonly string[]).includes(
      String(body.priority ?? "")
    )
      ? String(body.priority)
      : "medium";
    const status = (STATUSES as readonly string[]).includes(
      String(body.status ?? "")
    )
      ? String(body.status)
      : "todo";

    const { data: task, error } = await supabase
      .from("admin_control_tasks")
      .insert({
        title,
        description: sanitizeTaskText(body.description, 4000) || null,
        priority,
        status,
        due_at: body.due_at ? String(body.due_at) : null,
        country_code: body.country_code
          ? sanitizeTaskText(body.country_code, 8)
          : null,
        region: body.region ? sanitizeTaskText(body.region, 80) : null,
        privacy:
          privacy === "restricted" || privacy === "confidential"
            ? privacy
            : "internal",
        checklist: Array.isArray(body.checklist) ? body.checklist.slice(0, 50) : [],
        created_by: session.userId,
      })
      .select("*")
      .single();

    if (error) {
      return json(
        {
          ok: false,
          error: error.message,
          pending_migration: isMissingTableError(error.message),
        },
        isMissingTableError(error.message) ? 503 : 500
      );
    }

    const assigneeIds = Array.isArray(body.assignee_ids)
      ? body.assignee_ids.map(String).filter(Boolean).slice(0, 50)
      : [];
    if (assigneeIds.length) {
      const { error: assignErr } = await supabase
        .from("admin_control_task_assignees")
        .insert(assigneeIds.map((admin_id) => ({ task_id: task.id, admin_id })));
      if (assignErr) {
        return json({ ok: false, error: assignErr.message }, 500);
      }
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_task_created",
      targetType: "admin_control_task",
      targetId: String(task.id),
      metadata: { title, priority, status, assigneeIds },
      request,
    }).catch(() => undefined);

    return json({ ok: true, item: { ...task, assignee_ids: assigneeIds } });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

async function loadTaskForSession(
  session: AdminSession,
  id: string
): Promise<{ task: AdminTaskRow | null; error?: string; missing?: boolean }> {
  const supabase = buildSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_control_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return {
      task: null,
      error: error.message,
      missing: isMissingTableError(error.message),
    };
  }
  if (!data) return { task: null };
  const assignees = await loadAssignees(supabase, [id]);
  const task = attachAssignees([data as AdminTaskRow], assignees)[0];
  if (!canViewTask(session, task)) return { task: null };
  return { task };
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id required" }, 400);

    const loaded = await loadTaskForSession(session, id);
    if (loaded.missing) {
      return json({ ok: false, error: "Tasks migration not applied", pending_migration: true }, 503);
    }
    if (loaded.error) return json({ ok: false, error: loaded.error }, 500);
    if (!loaded.task) return json({ ok: false, error: "Not found" }, 404);
    if (!canMutateTask(session, loaded.task)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title != null) {
      const title = sanitizeTaskText(body.title, 200);
      if (!title) return json({ ok: false, error: "title required" }, 400);
      patch.title = title;
    }
    if (body.description != null) {
      patch.description = sanitizeTaskText(body.description, 4000) || null;
    }
    if (body.priority && (PRIORITIES as readonly string[]).includes(String(body.priority))) {
      patch.priority = String(body.priority);
    }
    if (body.status && (STATUSES as readonly string[]).includes(String(body.status))) {
      patch.status = String(body.status);
    }
    if (body.due_at !== undefined) {
      patch.due_at = body.due_at ? String(body.due_at) : null;
    }
    if (body.privacy != null) {
      const privacy = String(body.privacy);
      if (privacy === "confidential" && !canCreateConfidential(session)) {
        return json({ ok: false, error: "Forbidden confidential task" }, 403);
      }
      if (
        privacy === "internal" ||
        privacy === "restricted" ||
        privacy === "confidential"
      ) {
        patch.privacy = privacy;
      }
    }

    const { data: task, error } = await supabase
      .from("admin_control_tasks")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return json({ ok: false, error: error.message }, 500);

    let assigneeIds = loaded.task.assignee_ids ?? [];
    if (Array.isArray(body.assignee_ids)) {
      if (!isFounderOrSuperAdmin(session) && loaded.task.created_by !== session.userId) {
        return json({ ok: false, error: "Only creator can reassign" }, 403);
      }
      await supabase.from("admin_control_task_assignees").delete().eq("task_id", id);
      assigneeIds = body.assignee_ids.map(String).filter(Boolean).slice(0, 50);
      if (assigneeIds.length) {
        const { error: assignErr } = await supabase
          .from("admin_control_task_assignees")
          .insert(assigneeIds.map((admin_id) => ({ task_id: id, admin_id })));
        if (assignErr) return json({ ok: false, error: assignErr.message }, 500);
      }
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_task_updated",
      targetType: "admin_control_task",
      targetId: id,
      metadata: { patch, assigneeIds },
      request,
    }).catch(() => undefined);

    return json({ ok: true, item: { ...task, assignee_ids: assigneeIds } });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const id = String(body.id ?? request.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return json({ ok: false, error: "id required" }, 400);

    const loaded = await loadTaskForSession(session, id);
    if (loaded.missing) {
      return json({ ok: false, error: "Tasks migration not applied", pending_migration: true }, 503);
    }
    if (loaded.error) return json({ ok: false, error: loaded.error }, 500);
    if (!loaded.task) return json({ ok: false, error: "Not found" }, 404);
    if (!canDeleteTask(session, loaded.task)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const { error } = await supabase
      .from("admin_control_tasks")
      .delete()
      .eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_task_deleted",
      targetType: "admin_control_task",
      targetId: id,
      metadata: { title: loaded.task.title },
      request,
    }).catch(() => undefined);

    return json({ ok: true, deleted: true, id });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
