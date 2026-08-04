import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { isFounderOrSuperAdmin } from "@/lib/adminTasksAccess";
import { STAFF_ROLES } from "@/lib/adminRbac";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const supabase = buildSupabaseAdminClient();
    const focusId =
      request.nextUrl.searchParams.get("admin_id") ||
      (isFounderOrSuperAdmin(session) ? null : session.userId);

    if (
      focusId &&
      focusId !== session.userId &&
      !isFounderOrSuperAdmin(session)
    ) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const { data: staff, error: staffErr } = await supabase
      .from("profiles")
      .select(
        "id, role, full_name, email, staff_country_code, staff_region_code, staff_city, staff_department, presence_status, last_seen_at, is_founder, account_status"
      )
      .in("role", [
        ...STAFF_ROLES,
        "admin",
        "ops",
        "finance",
        "support",
        "review",
        "founder",
      ])
      .order("full_name", { ascending: true });
    if (staffErr) return json({ ok: false, error: staffErr.message }, 500);

    const staffIds = (staff ?? []).map((s) => String(s.id));
    const since7 = daysAgo(7);
    const since30 = daysAgo(30);

    const { data: tasks } = await supabase
      .from("admin_control_tasks")
      .select("id, status, due_at, created_by, created_at, updated_at")
      .limit(5000);
    const { data: assignees } = await supabase
      .from("admin_control_task_assignees")
      .select("task_id, admin_id")
      .in("admin_id", staffIds.length ? staffIds : ["00000000-0000-0000-0000-000000000000"]);

    const { data: audits } = await supabase
      .from("admin_audit_logs")
      .select("admin_user_id, action, created_at")
      .gte("created_at", since30)
      .limit(10000);

    type Perf = {
      admin_id: string;
      tasks_assigned: number;
      tasks_done: number;
      tasks_overdue: number;
      avg_resolution_hours: number | null;
      drivers_approved: number;
      restaurants_approved: number;
      sellers_approved: number;
      refunds_validated: number;
      incidents_handled: number;
      support_tickets: number;
      activity_7d: number;
      activity_30d: number;
      success_rate: number;
      workload: number;
    };

    const byAdmin = new Map<string, Perf>();
    for (const id of staffIds) {
      byAdmin.set(id, {
        admin_id: id,
        tasks_assigned: 0,
        tasks_done: 0,
        tasks_overdue: 0,
        avg_resolution_hours: null,
        drivers_approved: 0,
        restaurants_approved: 0,
        sellers_approved: 0,
        refunds_validated: 0,
        incidents_handled: 0,
        support_tickets: 0,
        activity_7d: 0,
        activity_30d: 0,
        success_rate: 0,
        workload: 0,
      });
    }

    const taskById = new Map((tasks ?? []).map((t) => [String(t.id), t]));
    const resolutionHours: Record<string, number[]> = {};

    for (const a of assignees ?? []) {
      const perf = byAdmin.get(String(a.admin_id));
      const task = taskById.get(String(a.task_id));
      if (!perf || !task) continue;
      perf.tasks_assigned += 1;
      if (task.status === "done") {
        perf.tasks_done += 1;
        const hours =
          (new Date(task.updated_at).getTime() -
            new Date(task.created_at).getTime()) /
          36e5;
        if (Number.isFinite(hours) && hours >= 0) {
          (resolutionHours[perf.admin_id] ??= []).push(hours);
        }
      }
      if (
        task.due_at &&
        new Date(task.due_at).getTime() < Date.now() &&
        !["done", "cancelled"].includes(String(task.status))
      ) {
        perf.tasks_overdue += 1;
      }
      if (!["done", "cancelled"].includes(String(task.status))) {
        perf.workload += 1;
      }
    }

    for (const [adminId, hours] of Object.entries(resolutionHours)) {
      const perf = byAdmin.get(adminId);
      if (!perf || !hours.length) continue;
      perf.avg_resolution_hours =
        Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10;
    }

    for (const row of audits ?? []) {
      const adminId = String(row.admin_user_id ?? "");
      const perf = byAdmin.get(adminId);
      if (!perf) continue;
      const created = String(row.created_at ?? "");
      perf.activity_30d += 1;
      if (created >= since7) perf.activity_7d += 1;
      const action = String(row.action ?? "");
      if (action === "driver_approved") perf.drivers_approved += 1;
      if (action === "restaurant_approved") perf.restaurants_approved += 1;
      if (action.includes("seller") && action.includes("approv")) {
        perf.sellers_approved += 1;
      }
      if (action.includes("refund")) perf.refunds_validated += 1;
      if (action.includes("incident") || action.includes("safety")) {
        perf.incidents_handled += 1;
      }
      if (action.includes("chat") || action.includes("support")) {
        perf.support_tickets += 1;
      }
    }

    for (const perf of byAdmin.values()) {
      perf.success_rate =
        perf.tasks_assigned === 0
          ? 0
          : Math.round((perf.tasks_done / perf.tasks_assigned) * 100);
    }

    const metrics = Array.from(byAdmin.values());
    const people = (staff ?? []).map((s) => ({
      ...s,
      performance: byAdmin.get(String(s.id)) ?? null,
    }));

    const scoped = focusId
      ? people.filter((p) => p.id === focusId)
      : people;

    const hr =
      isFounderOrSuperAdmin(session) && !focusId
        ? {
            totals: {
              admins: people.length,
              online: people.filter((p) => p.presence_status === "online")
                .length,
              overdue_tasks: metrics.reduce((s, m) => s + m.tasks_overdue, 0),
              activity_7d: metrics.reduce((s, m) => s + m.activity_7d, 0),
            },
            by_department: aggregateBy(
              people,
              (p) => String(p.staff_department || p.role || "unknown"),
              (p) => p.performance
            ),
            by_country: aggregateBy(
              people,
              (p) => String(p.staff_country_code || "unassigned"),
              (p) => p.performance
            ),
            by_region: aggregateBy(
              people,
              (p) =>
                `${p.staff_country_code || "?"} / ${p.staff_region_code || "unassigned"}`,
              (p) => p.performance
            ),
            top_performers: [...metrics]
              .sort((a, b) => b.success_rate - a.success_rate || b.tasks_done - a.tasks_done)
              .slice(0, 5),
            needs_attention: [...metrics]
              .filter((m) => m.tasks_overdue > 0 || m.success_rate < 50)
              .sort((a, b) => b.tasks_overdue - a.tasks_overdue)
              .slice(0, 8),
          }
        : null;

    return json({
      ok: true,
      items: scoped,
      hr,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

function aggregateBy<T extends { performance: { tasks_done: number; workload: number; activity_7d: number } | null }>(
  people: T[],
  keyFn: (p: T) => string,
  perfFn: (p: T) => { tasks_done: number; workload: number; activity_7d: number } | null
) {
  const map = new Map<
    string,
    { key: string; people: number; tasks_done: number; workload: number; activity_7d: number }
  >();
  for (const p of people) {
    const key = keyFn(p);
    const cur = map.get(key) ?? {
      key,
      people: 0,
      tasks_done: 0,
      workload: 0,
      activity_7d: 0,
    };
    const perf = perfFn(p);
    cur.people += 1;
    cur.tasks_done += perf?.tasks_done ?? 0;
    cur.workload += perf?.workload ?? 0;
    cur.activity_7d += perf?.activity_7d ?? 0;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.activity_7d - a.activity_7d);
}
