import { buildConferenceJoinTwiml } from "@/lib/adminVoiceConference";
import {
  buildAdminDialTwiml,
  escapeTwiml,
  getAdminSupportPhone,
  isAllowedAdminVoiceDestinationPhone,
  assertEligibleAdminVoiceDestination,
  type AdminVoiceDestinationProfile,
} from "@/lib/adminVoiceTransfer";
import { normalizePhoneE164, phonesEquivalent } from "@/lib/phoneE164";
import {
  getTwilioVoiceIvrBaseUrl,
  TWILIO_VOICE_IVR_PATH,
} from "@/lib/twilioProductionUrls";

export { TWILIO_VOICE_IVR_PATH };

export const MAX_IVR_EMPTY_ATTEMPTS = 2;
export const IVR_REPEAT_DIGIT = "9";

export const ADMIN_VOICE_SERVICES = [
  "delivery",
  "package",
  "payment",
  "taxi",
  "restaurant",
  "account",
  "general",
] as const;

export type AdminVoiceService = (typeof ADMIN_VOICE_SERVICES)[number];

export const IVR_DIGIT_TO_SERVICE: Record<string, AdminVoiceService> = {
  "1": "delivery",
  "2": "package",
  "3": "payment",
  "4": "taxi",
  "5": "restaurant",
  "6": "account",
};

export const ADMIN_VOICE_SERVICE_LABELS: Record<AdminVoiceService, string> = {
  delivery: "Delivery",
  package: "Package Delivery",
  payment: "Payment & Billing",
  taxi: "Taxi / Ride",
  restaurant: "Restaurant Support",
  account: "Account / General",
  general: "General Support",
};

const SERVICE_PHONE_ENV: Record<AdminVoiceService, string> = {
  delivery: "MMD_ADMIN_SUPPORT_PHONE_DELIVERY",
  package: "MMD_ADMIN_SUPPORT_PHONE_PACKAGE",
  payment: "MMD_ADMIN_SUPPORT_PHONE_PAYMENT",
  taxi: "MMD_ADMIN_SUPPORT_PHONE_TAXI",
  restaurant: "MMD_ADMIN_SUPPORT_PHONE_RESTAURANT",
  account: "MMD_ADMIN_SUPPORT_PHONE_ACCOUNT",
  general: "MMD_ADMIN_SUPPORT_PHONE",
};

export type IvrVoiceLocale = "fr" | "en";

const IVR_TWILIO_LANG: Record<IvrVoiceLocale, string> = {
  fr: "fr-FR",
  en: "en-US",
};

export const IVR_MENU_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: [
    "Bienvenue chez MMD Delivery.",
    "Pour le support livraison, appuyez sur 1.",
    "Pour la livraison de colis, appuyez sur 2.",
    "Pour le paiement et la facturation, appuyez sur 3.",
    "Pour un taxi ou une course, appuyez sur 4.",
    "Pour le support restaurant, appuyez sur 5.",
    "Pour un compte ou le support général, appuyez sur 6.",
    "Pour répéter ce menu, appuyez sur 9.",
  ].join(" "),
  en: [
    "Welcome to MMD Delivery.",
    "For delivery support, press 1.",
    "For package delivery, press 2.",
    "For payment and billing, press 3.",
    "For taxi and rides, press 4.",
    "For restaurant support, press 5.",
    "For account and general support, press 6.",
    "To repeat this menu, press 9.",
  ].join(" "),
};

export const IVR_INVALID_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Cette option n'est pas valide. Veuillez réessayer.",
  en: "That is not a valid option. Please try again.",
};

export const IVR_TIMEOUT_FALLBACK_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Nous n'avons pas détecté votre choix. Veuillez rester en ligne, nous vous transférons vers le support.",
  en: "We are unable to detect your selection. Please stay on the line while we connect you to support.",
};

export const IVR_CONNECT_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Veuillez patienter pendant que nous vous connectons à notre équipe de support.",
  en: "Please wait while we connect you to our support team.",
};

export const IVR_NO_ANSWER_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Tous nos représentants sont actuellement indisponibles. Veuillez laisser un message ou rappeler plus tard.",
  en: "All of our support representatives are currently unavailable. Please leave a message or try again later.",
};

export type IvrGatherDecision =
  | { action: "connect"; digit: string; service: AdminVoiceService }
  | { action: "fallback"; digit: "0"; service: "general" }
  | { action: "repeat"; attempt: number; invalid: boolean };

export function getIvrVoiceLocales(
  raw = process.env.MMD_VOICE_IVR_LOCALES,
): IvrVoiceLocale[] {
  const parsed = String(raw ?? "fr,en")
    .split(",")
    .map((part) => part.trim().toLowerCase().slice(0, 2))
    .filter((part): part is IvrVoiceLocale => part === "fr" || part === "en");
  return parsed.length > 0 ? parsed : ["fr", "en"];
}

function ivrSayBlocks(textByLocale: Record<IvrVoiceLocale, string>): string {
  return getIvrVoiceLocales()
    .map((locale) => {
      const language = IVR_TWILIO_LANG[locale];
      return `<Say voice="alice" language="${language}">${escapeTwiml(textByLocale[locale])}</Say>`;
    })
    .join("\n    ");
}

export function getTwilioVoiceIvrUrl(attempt = 0): string {
  const base = getTwilioVoiceIvrBaseUrl();
  const url = new URL(base);
  url.searchParams.set("attempt", String(Math.max(0, attempt)));
  return url.toString();
}

export function parseIvrAttempt(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 9);
}

export function resolveIvrDigit(
  digits: string | null | undefined,
): { digit: string; service: AdminVoiceService } | null {
  const digit = String(digits ?? "").trim().slice(-1);
  if (digit === IVR_REPEAT_DIGIT) return null;
  const service = IVR_DIGIT_TO_SERVICE[digit];
  if (!service) return null;
  return { digit, service };
}

export function decideIvrGather(params: {
  digits: string | null | undefined;
  attempt: number;
}): IvrGatherDecision {
  const raw = String(params.digits ?? "").trim();
  const digit = raw.slice(-1);

  if (digit === IVR_REPEAT_DIGIT) {
    return { action: "repeat", attempt: params.attempt, invalid: false };
  }

  const resolved = resolveIvrDigit(params.digits);
  if (resolved) {
    return { action: "connect", digit: resolved.digit, service: resolved.service };
  }

  if (raw.length > 0) {
    return { action: "repeat", attempt: params.attempt, invalid: true };
  }

  if (params.attempt >= MAX_IVR_EMPTY_ATTEMPTS) {
    return { action: "fallback", digit: "0", service: "general" };
  }

  return { action: "repeat", attempt: params.attempt + 1, invalid: false };
}

export function getSupportPhoneForService(service: AdminVoiceService | null | undefined): string {
  const key =
    service && SERVICE_PHONE_ENV[service]
      ? SERVICE_PHONE_ENV[service]
      : "MMD_ADMIN_SUPPORT_PHONE";
  const fromEnv = String(process.env[key] ?? "").trim();
  return fromEnv || getAdminSupportPhone();
}

export function adminVoiceServiceLabel(service: string | null | undefined): string {
  if (service && service in ADMIN_VOICE_SERVICE_LABELS) {
    return ADMIN_VOICE_SERVICE_LABELS[service as AdminVoiceService];
  }
  return ADMIN_VOICE_SERVICE_LABELS.general;
}

export function pickInboundSupportDestination(params: {
  profiles: AdminVoiceDestinationProfile[];
  preferredPhone?: string | null;
}): { phone: string; userId: string | null } | null {
  const eligible = params.profiles
    .map((profile) => {
      const result = assertEligibleAdminVoiceDestination(profile);
      if (result.ok === false) return null;
      return { phone: result.phone, userId: profile.id };
    })
    .filter((row): row is { phone: string; userId: string } => Boolean(row));

  const preferred = normalizePhoneE164(params.preferredPhone);
  if (preferred && isAllowedAdminVoiceDestinationPhone(preferred)) {
    const matched = eligible.find((row) => phonesEquivalent(row.phone, preferred));
    if (matched) return matched;
    return { phone: preferred, userId: null };
  }

  return eligible[0] ?? null;
}

export function buildIvrGatherTwiml(params: {
  attempt: number;
  invalid?: boolean;
}): string {
  const actionUrl = getTwilioVoiceIvrUrl(params.attempt);
  const intro = params.invalid ? ivrSayBlocks(IVR_INVALID_PROMPT) : "";

  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${intro}
  <Gather
    numDigits="1"
    timeout="7"
    actionOnEmptyResult="true"
    method="POST"
    action="${escapeTwiml(actionUrl)}"
  >
    ${ivrSayBlocks(IVR_MENU_PROMPT)}
  </Gather>
</Response>
  `.trim();
}

export function ivrConnectPrefixSay(fallback?: boolean): string {
  const prefix = fallback ? IVR_TIMEOUT_FALLBACK_PROMPT : IVR_CONNECT_PROMPT;
  return getIvrVoiceLocales()
    .map((locale) => prefix[locale])
    .join(" ");
}

export function buildIvrConnectTwiml(params: {
  service: AdminVoiceService;
  destPhone: string;
  fallback?: boolean;
}): string {
  return buildAdminDialTwiml({
    destPhone: params.destPhone,
    includeWelcome: false,
    prefixSay: ivrConnectPrefixSay(params.fallback),
  });
}

export function buildIvrConferenceConnectTwiml(params: {
  conferenceName: string;
  fallback?: boolean;
}): string {
  return buildConferenceJoinTwiml({
    conferenceName: params.conferenceName,
    startOnEnter: true,
    endOnExit: true,
    prefixSay: ivrConnectPrefixSay(params.fallback),
  });
}

export function buildIvrUnavailableTwiml(): string {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${ivrSayBlocks(IVR_NO_ANSWER_PROMPT)}
  <Record
    maxLength="180"
    playBeep="true"
    transcribe="false"
    trim="trim-silence"
  />
  ${ivrSayBlocks({
    fr: "Merci d'avoir appelé MMD Delivery. Au revoir.",
    en: "Thank you for calling MMD Delivery. Goodbye.",
  })}
</Response>
  `.trim();
}

export function shouldAlertIncomingAdminVoice(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return ["incoming", "in_ivr", "ringing", "queued"].includes(normalized);
}

export function shouldStopIncomingAdminVoiceAlert(status: string | null | undefined): boolean {
  return !shouldAlertIncomingAdminVoice(status);
}

export function mergeAdminVoiceRealtimeRows<T extends { id: string }>(
  current: T[],
  event: "INSERT" | "UPDATE" | "DELETE" | "*",
  row: T | null | undefined,
): T[] {
  if (!row?.id) return current;
  if (event === "DELETE") {
    return current.filter((item) => item.id !== row.id);
  }

  const index = current.findIndex((item) => item.id === row.id);
  if (index === -1) {
    return [row, ...current];
  }

  const next = current.slice();
  next[index] = { ...current[index], ...row };
  return next;
}

export function computeAdminVoiceDashboardStats(
  rows: Array<{ status: string; service?: string | null }>,
) {
  const byService: Record<AdminVoiceService, number> = {
    delivery: 0,
    package: 0,
    payment: 0,
    taxi: 0,
    restaurant: 0,
    account: 0,
    general: 0,
  };

  const stats = {
    active: 0,
    incoming: 0,
    answered: 0,
    missed: 0,
    transferred: 0,
    completed: 0,
    byService,
  };

  for (const row of rows) {
    const status = String(row.status || "").trim().toLowerCase();
    if (
      ["incoming", "in_ivr", "queued", "ringing", "answered", "in_progress", "on_hold", "transferred"].includes(
        status,
      )
    ) {
      stats.active += 1;
    }
    if (["incoming", "in_ivr", "queued", "ringing"].includes(status)) stats.incoming += 1;
    if (status === "answered" || status === "in_progress" || status === "on_hold") {
      stats.answered += 1;
    }
    if (
      status === "missed" ||
      status === "canceled" ||
      status === "declined" ||
      status === "expired" ||
      status === "busy" ||
      status === "no_answer"
    ) {
      stats.missed += 1;
    }
    if (status === "transferred") stats.transferred += 1;
    if (status === "completed") stats.completed += 1;
    const service =
      row.service && row.service in byService
        ? (row.service as AdminVoiceService)
        : null;
    if (service) byService[service] += 1;
  }

  return stats;
}
