export type SmsKeywordKind = "stop" | "help" | "start" | "none";

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

const START_WORDS = new Set(["START", "UNSTOP", "YES"]);

const HELP_WORDS = new Set(["HELP", "INFO"]);

function normalizeKeyword(body: string): string {
  return String(body ?? "")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .toUpperCase();
}

export function classifySmsKeyword(body: string): SmsKeywordKind {
  const token = normalizeKeyword(body);
  if (!token) return "none";
  if (STOP_WORDS.has(token)) return "stop";
  if (HELP_WORDS.has(token)) return "help";
  if (START_WORDS.has(token)) return "start";
  return "none";
}

export function isStopKeyword(body: string): boolean {
  return classifySmsKeyword(body) === "stop";
}

export const SMS_STOP_KEYWORDS = [...STOP_WORDS];
export const SMS_HELP_KEYWORDS = [...HELP_WORDS];
export const SMS_START_KEYWORDS = [...START_WORDS];
