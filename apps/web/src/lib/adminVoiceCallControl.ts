import {
  ADMIN_VOICE_ACTIVE_STATUSES,
  ADMIN_VOICE_TERMINAL_STATUSES,
  isAdminVoiceCallActive,
  type AdminVoiceCallRow,
} from "@/lib/adminVoiceTransfer";
import { isAdminVoiceHoldAvailable } from "@/lib/adminVoiceConference";

/** Hold/Resume is real only when the support call is on a Twilio Conference. */
export const ADMIN_VOICE_HOLD_SUPPORTED = true;

export type AdminVoiceUserAction = "accept" | "decline" | "end" | "hold" | "resume";

export type AdminVoicePhase =
  | "incoming"
  | "connecting"
  | "connected"
  | "on_hold"
  | "ended";

export function adminVoicePhase(status: string | null | undefined): AdminVoicePhase {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "on_hold") return "on_hold";
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
  const phase = adminVoicePhase(status);
  return phase !== "incoming";
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
    if (["answered", "in_progress", "on_hold", "transferred"].includes(current)) {
      return "completed";
    }
    return "declined";
  }

  if (action === "end") {
    return "completed";
  }

  if (action === "hold") {
    if (["answered", "in_progress", "transferred", "on_hold"].includes(current)) {
      return "on_hold";
    }
    return null;
  }

  if (action === "resume") {
    if (current === "on_hold") return "answered";
    return null;
  }

  return null;
}

export function canPerformAdminVoiceAction(
  action: AdminVoiceUserAction,
  currentStatus: string | null | undefined,
): boolean {
  if (!isAdminVoiceCallActive(currentStatus)) return false;
  const current = String(currentStatus ?? "").trim().toLowerCase();
  if (action === "accept") {
    return ["incoming", "in_ivr", "queued", "ringing"].includes(current);
  }
  if (action === "hold") {
    return ["answered", "in_progress", "transferred"].includes(current);
  }
  if (action === "resume") {
    return current === "on_hold";
  }
  return true;
}

export function actorOwnsAdminVoiceCall(params: {
  actorUserId: string;
  isFounder: boolean;
  assignedAdminUserId?: string | null;
  currentAdminUserId?: string | null;
}): boolean {
  if (params.isFounder) return true;
  const owner =
    String(params.assignedAdminUserId ?? "").trim() ||
    String(params.currentAdminUserId ?? "").trim();
  if (!owner) return true;
  return owner === params.actorUserId;
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

  if (params.action === "hold") {
    patch.on_hold = true;
  }

  if (params.action === "resume") {
    patch.on_hold = false;
  }

  if (params.action === "decline" || params.action === "end") {
    patch.on_hold = false;
    patch.ended_at = params.nowIso;
  }

  return patch;
}

export function formatLiveCallClock(startedMs: number | null, nowMs = Date.now()): string {
  if (startedMs == null || !Number.isFinite(startedMs) || nowMs < startedMs) {
    return "00:00";
  }
  const sec = Math.floor((nowMs - startedMs) / 1000);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export { ADMIN_VOICE_ACTIVE_STATUSES, isAdminVoiceHoldAvailable };
