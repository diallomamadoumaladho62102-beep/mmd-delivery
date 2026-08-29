import { normalizePhoneE164, phonesEquivalent } from "@/lib/phoneE164";

export const ROUTABLE_MASKED_SESSION_STATUSES = [
  "active",
  "ringing",
  "connected",
] as const;

export type MaskedSessionCandidate = {
  id: string;
  caller_phone?: string | null;
  target_phone?: string | null;
  proxy_number?: string | null;
  status?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  twilio_call_sid?: string | null;
  caller_user_id?: string | null;
  target_user_id?: string | null;
  started_at?: string | null;
};

export type MaskedSessionMatch =
  | { ok: true; session: MaskedSessionCandidate }
  | { ok: false; reason: "none" | "ambiguous" | "expired" };

function isExpired(session: MaskedSessionCandidate, nowMs: number): boolean {
  const expires = Date.parse(String(session.expires_at ?? ""));
  return Number.isFinite(expires) && expires <= nowMs;
}

function createdAtMs(session: MaskedSessionCandidate): number {
  const value = Date.parse(String(session.created_at ?? ""));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Pick at most one masked-call session for an inbound Twilio From.
 * Ambiguous From collisions fail closed (support IVR) instead of dialing
 * the wrong participant.
 */
export function pickMaskedCallSession(params: {
  sessions: MaskedSessionCandidate[];
  from: string | null;
  to?: string | null;
  callSid?: string | null;
  nowMs?: number;
}): MaskedSessionMatch {
  const nowMs = params.nowMs ?? Date.now();
  const from = normalizePhoneE164(params.from);
  const to = normalizePhoneE164(params.to);
  const callSid = String(params.callSid ?? "").trim();

  const live = params.sessions.filter((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    if (
      !ROUTABLE_MASKED_SESSION_STATUSES.includes(
        status as (typeof ROUTABLE_MASKED_SESSION_STATUSES)[number]
      )
    ) {
      return false;
    }
    return !isExpired(row, nowMs);
  });

  if (callSid) {
    const bySid = live.filter(
      (row) => String(row.twilio_call_sid ?? "").trim() === callSid
    );
    if (bySid.length === 1) return { ok: true, session: bySid[0]! };
    if (bySid.length > 1) return { ok: false, reason: "ambiguous" };
  }

  if (!from) return { ok: false, reason: "none" };

  let matches = live.filter((row) => phonesEquivalent(row.caller_phone, from));

  if (to) {
    const proxyMatches = matches.filter((row) =>
      phonesEquivalent(row.proxy_number, to)
    );
    if (proxyMatches.length > 0) matches = proxyMatches;
  }

  if (matches.length === 0) return { ok: false, reason: "none" };
  if (matches.length === 1) return { ok: true, session: matches[0]! };

  matches.sort((a, b) => createdAtMs(b) - createdAtMs(a));
  const newest = createdAtMs(matches[0]!);
  const tied = matches.filter((row) => createdAtMs(row) === newest);
  if (tied.length > 1) return { ok: false, reason: "ambiguous" };

  return { ok: false, reason: "ambiguous" };
}
