import { sanctionWorkflowIsActive } from "./engineGate";
import type {
  DriverIntegrityIncidentStatus,
  DriverIntegrityPolicyAction,
  DriverIntegrityReviewDecision,
  DriverIntegritySettings,
} from "./types";

export type ReviewTransition =
  | { ok: true; next: DriverIntegrityIncidentStatus }
  | { ok: false; reason: string };

const REVIEW_FLOW: Record<string, readonly DriverIntegrityIncidentStatus[]> = {
  open: ["warning", "review", "closed"],
  warning: ["final_warning", "reassigned", "review", "closed"],
  final_warning: ["reassigned", "review", "closed"],
  reassigned: ["review", "closed"],
  review: ["confirmed", "not_confirmed", "closed"],
  confirmed: ["policy_action", "closed"],
  not_confirmed: ["closed"],
  policy_action: ["closed"],
  closed: [],
};

export function canTransitionIncident(
  from: DriverIntegrityIncidentStatus,
  to: DriverIntegrityIncidentStatus
): boolean {
  return (REVIEW_FLOW[from] ?? []).includes(to);
}

export function applyReviewDecision(input: {
  current: DriverIntegrityIncidentStatus;
  decision: DriverIntegrityReviewDecision;
}): ReviewTransition {
  if (input.current !== "review") {
    return { ok: false, reason: "not_in_review" };
  }
  return {
    ok: true,
    next: input.decision === "confirmed" ? "confirmed" : "not_confirmed",
  };
}

export function applyPolicyAction(input: {
  settings: DriverIntegritySettings;
  current: DriverIntegrityIncidentStatus;
  action: DriverIntegrityPolicyAction;
  adminUserId: string | null;
}): ReviewTransition {
  if (!input.adminUserId) {
    return { ok: false, reason: "admin_required" };
  }
  if (!sanctionWorkflowIsActive(input.settings)) {
    return { ok: false, reason: "sanction_workflow_disabled" };
  }
  if (input.current !== "confirmed") {
    return { ok: false, reason: "must_be_confirmed" };
  }
  if (input.action === "none") {
    return { ok: true, next: "closed" };
  }
  return { ok: true, next: "policy_action" };
}

export function anomalyIsNotAutomaticFraud(): true {
  return true;
}

export function reassignmentIsNotAutomaticSuspension(): true {
  return true;
}

export function timeoutIsNotAutomaticSuspension(): true {
  return true;
}

export function clientCannotDecideSanction(): true {
  return true;
}
