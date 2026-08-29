import type { AdminSession } from "@/lib/adminServer";

export type AdminTaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_at: string | null;
  country_code: string | null;
  region: string | null;
  privacy: string;
  checklist: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assignee_ids?: string[];
};

export function isFounderOrSuperAdmin(session: AdminSession): boolean {
  return session.isFounder === true || session.role === "super_admin";
}

/** Sanitize free-text fields before persistence (defense in depth vs stored XSS). */
export function sanitizeTaskText(value: unknown, maxLen = 4000): string {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    // Strip C0 controls except tab/newline/carriage-return.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    out += ch;
  }
  let previous = "";
  while (previous !== out) {
    previous = out;
    out = out.replace(/<[^>]*>/g, "");
  }
  return out.trim().slice(0, maxLen);
}

export function canViewTask(
  session: AdminSession,
  task: Pick<AdminTaskRow, "privacy" | "created_by" | "assignee_ids">
): boolean {
  if (isFounderOrSuperAdmin(session)) return true;
  if (task.privacy === "confidential") return false;
  if (task.created_by && task.created_by === session.userId) return true;
  return (task.assignee_ids ?? []).includes(session.userId);
}

export function canMutateTask(
  session: AdminSession,
  task: Pick<AdminTaskRow, "privacy" | "created_by" | "assignee_ids">
): boolean {
  if (isFounderOrSuperAdmin(session)) return true;
  if (task.privacy === "confidential") return false;
  if (task.created_by && task.created_by === session.userId) return true;
  return (task.assignee_ids ?? []).includes(session.userId);
}

export function canDeleteTask(
  session: AdminSession,
  task: Pick<AdminTaskRow, "privacy" | "created_by">
): boolean {
  if (isFounderOrSuperAdmin(session)) return true;
  if (task.privacy === "confidential") return false;
  return task.created_by === session.userId;
}

export function canCreateConfidential(session: AdminSession): boolean {
  return isFounderOrSuperAdmin(session);
}
