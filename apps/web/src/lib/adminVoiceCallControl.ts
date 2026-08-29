import {
  ADMIN_VOICE_ACTIVE_STATUSES,
  ADMIN_VOICE_TERMINAL_STATUSES,
  isAdminVoiceCallActive,
  type AdminVoiceCallRow,
} from "@/lib/adminVoiceTransfer";

export const ADMIN_VOICE_HOLD_SUPPORTED = false;

export type AdminVoiceUserAction = "accept" | "decline" | "end";

export type AdminVoicePhase =
  | "incoming"
  | "connecting"
  | "connected"
  | "ended";

export function adminVoicePhase(status: string | null | undefined): AdminVoicePhase {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (["answered", "in_progress", "transferred"].includes(normalized)) {
    return "connected";
  }
  if (["ringing", "queued"].includes(normalized)) return "connecting";
  if (["incoming", "in_ivr"].includes(normalized)) return "incoming";
  return "ended";
}

export function shouldStopAdminVoiceRinging(
  status: string | null | undefined,
): boolean {
  return adminVoicePhase(status) !== "incoming";
}

export function nextStatusAfterAdminVoiceAction(
  action: AdminVoiceUserAction,
  currentStatus: string | null | undefined,
): string | null {
  const current = String(currentStatus ?? "").trim().toLowerCase();
  if ((ADMIN_VOICE_TERMINAL_STATUSES as readonly string[]).includes(current)) {
    return null;
  }

  if (action === "accept") {
    if (["incoming", "in_ivr", "queued", "ringing"].includes(current)) {
      return "ringing";
    }
    return current || "ringing";
  }

  if (action === "decline") {
    if (["answered", "in_progress", "transferred"].includes(current)) {
      return "completed";
    }
    return "canceled";
  }

  if (action === "end") {
    return "completed";
  }

  return null;
}

export function canPerformAdminVoiceAction(
  action: AdminVoiceUserAction,
  currentStatus: string | null | undefined,
): boolean {
  if (!isAdminVoiceCallActive(currentStatus)) return false;
  if (action === "accept") {
    return ["incoming", "in_ivr", "queued", "ringing"].includes(
      String(currentStatus ?? "").trim().toLowerCase(),
    );
  }
  return true;
}

export function adminVoiceActionPatch(params: {
  action: AdminVoiceUserAction;
  actorUserId: string;
  current: Pick<
    AdminVoiceCallRow,
    "status" | "assigned_admin_user_id" | "current_admin_user_id"
  >;
  nowIso: string;
}): Record<string, unknown> | null {
  if (!canPerformAdminVoiceAction(params.action, params.current.status)) {
    return null;
  }
  const next = nextStatusAfterAdminVoiceAction(
    params.action,
    params.current.status,
  );
  if (!next) return null;

  const patch: Record<string, unknown> = {
    status: next,
    updated_at: params.nowIso,
  };

  if (params.action === "accept") {
    patch.assigned_admin_user_id = params.actorUserId;
    patch.current_admin_user_id = params.actorUserId;
  }

  return patch;
}

export function formatLiveCallClock(startedMs: number | null, nowMs = Date.now()): string {
  if (startedMs == null || !Number.isFinite(startedMs) || nowMs < startedMs) {
    return "00:00";
  }
  const sec = Math.floor((nowMs - startedMs) / 1000);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export { ADMIN_VOICE_ACTIVE_STATUSES };
