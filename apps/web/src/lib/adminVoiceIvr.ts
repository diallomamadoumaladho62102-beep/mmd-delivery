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

/** Service menu digits — only valid AFTER language is selected. */
export const IVR_DIGIT_TO_SERVICE: Record<string, AdminVoiceService> = {
  "1": "delivery",
  "2": "package",
  "3": "payment",
  "4": "taxi",
  "5": "restaurant",
  "6": "account",
};

/** First IVR menu: language selection (mandatory before any service). */
export const IVR_DIGIT_TO_LOCALE = {
  "1": "fr",
  "2": "en",
  "3": "es",
  "4": "ar",
  "5": "zh",
  "6": "ff",
} as const;

export type IvrVoiceLocale = (typeof IVR_DIGIT_TO_LOCALE)[keyof typeof IVR_DIGIT_TO_LOCALE];

export const IVR_SUPPORTED_LOCALES: readonly IvrVoiceLocale[] = [
  "fr",
  "en",
  "es",
  "ar",
  "zh",
  "ff",
] as const;

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

/**
 * Twilio <Say> voice/language per locale.
 * Fulfulde has no Twilio TTS — fr-FR is the best-effort carrier for FF prompts.
 * Arabic uses Polly.Zeina (Alice has no Arabic).
 * See IVR_FF_TTS_NOTE.
 */
export const IVR_FF_TTS_NOTE =
  "Fulfulde IVR prompts use Fulfulde text with Twilio alice language=fr-FR (no native ff TTS). Locale remains ff for the call.";

export const IVR_TWILIO_VOICE: Record<
  IvrVoiceLocale,
  { voice: string; language: string }
> = {
  fr: { voice: "alice", language: "fr-FR" },
  en: { voice: "alice", language: "en-US" },
  es: { voice: "alice", language: "es-MX" },
  ar: { voice: "Polly.Zeina", language: "arb" },
  zh: { voice: "alice", language: "zh-CN" },
  ff: { voice: "alice", language: "fr-FR" },
};

/** One line per language for the opening language menu (spoken in that language). */
export const IVR_LANGUAGE_MENU_LINES: Record<IvrVoiceLocale, string> = {
  fr: "Bienvenue chez MMD Delivery. Pour continuer en français, appuyez sur 1.",
  en: "For English, press 2.",
  es: "Para continuar en español, presione 3.",
  ar: "للمتابعة بالعربية، اضغط على 4.",
  zh: "继续使用中文，请按 5。",
  ff: "Ngam jokkude e Pulaar / Fulfulde, ɓeydu 6.",
};

export const IVR_LANGUAGE_INVALID_LINES: Record<IvrVoiceLocale, string> = {
  fr: "Cette option n'est pas valide.",
  en: "That is not a valid option.",
  es: "Esa no es una opción válida.",
  ar: "هذا الخيار غير صالح.",
  zh: "该选项无效。",
  ff: "Cuɓal ngal moƴƴaani.",
};

export const IVR_SERVICE_MENU_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: [
    "Quel service souhaitez-vous utiliser ?",
    "Pour le support livraison, appuyez sur 1.",
    "Pour la livraison de colis, appuyez sur 2.",
    "Pour le paiement et la facturation, appuyez sur 3.",
    "Pour un taxi ou une course, appuyez sur 4.",
    "Pour le support restaurant, appuyez sur 5.",
    "Pour un compte ou le support général, appuyez sur 6.",
    "Pour répéter ce menu, appuyez sur 9.",
  ].join(" "),
  en: [
    "Which service would you like to use?",
    "For delivery support, press 1.",
    "For package delivery, press 2.",
    "For payment and billing, press 3.",
    "For taxi and rides, press 4.",
    "For restaurant support, press 5.",
    "For account and general support, press 6.",
    "To repeat this menu, press 9.",
  ].join(" "),
  es: [
    "¿Qué servicio desea utilizar?",
    "Para soporte de entrega, presione 1.",
    "Para entrega de paquetes, presione 2.",
    "Para pagos y facturación, presione 3.",
    "Para taxi o viaje, presione 4.",
    "Para soporte de restaurante, presione 5.",
    "Para cuenta o soporte general, presione 6.",
    "Para repetir este menú, presione 9.",
  ].join(" "),
  ar: [
    "ما الخدمة التي تريد استخدامها؟",
    "لدعم التوصيل، اضغط 1.",
    "لتوصيل الطرود، اضغط 2.",
    "للدفع والفوترة، اضغط 3.",
    "للتاكسي أو الرحلة، اضغط 4.",
    "لدعم المطاعم، اضغط 5.",
    "للحساب أو الدعم العام، اضغط 6.",
    "لإعادة هذه القائمة، اضغط 9.",
  ].join(" "),
  zh: [
    "您想使用哪项服务？",
    "配送支持请按 1。",
    "包裹配送请按 2。",
    "付款与账单请按 3。",
    "出租车或行程请按 4。",
    "餐厅支持请按 5。",
    "账户或一般支持请按 6。",
    "重听本菜单请按 9。",
  ].join(" "),
  ff: [
    "Holi sarwiis mo njiɗɗaa huutoraade?",
    "Ngám ballal delivery, ɓeydu 1.",
    "Ngám neldugol pakke, ɓeydu 2.",
    "Ngám njoɓdi e faktuur, ɓeydu 3.",
    "Ngám taksi walla yahdu, ɓeydu 4.",
    "Ngám ballal restoraŋ, ɓeydu 5.",
    "Ngám kontu walla ballal kuuɓal, ɓeydu 6.",
    "Ngám waɗtude oo menu, ɓeydu 9.",
  ].join(" "),
};

export const IVR_INVALID_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Cette option n'est pas valide. Veuillez réessayer.",
  en: "That is not a valid option. Please try again.",
  es: "Esa no es una opción válida. Inténtelo de nuevo.",
  ar: "هذا الخيار غير صالح. يرجى المحاولة مرة أخرى.",
  zh: "该选项无效。请重试。",
  ff: "Cuɓal ngal moƴƴaani. Ena njahdaa kadi.",
};

export const IVR_TIMEOUT_FALLBACK_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Nous n'avons pas détecté votre choix. Veuillez rester en ligne, nous vous transférons vers le support.",
  en: "We are unable to detect your selection. Please stay on the line while we connect you to support.",
  es: "No detectamos su selección. Permanezca en línea mientras lo conectamos con soporte.",
  ar: "لم نتمكن من اكتشاف اختيارك. يرجى البقاء على الخط بينما نوصلك بالدعم.",
  zh: "未能检测到您的选择。请稍候，我们将为您转接支持。",
  ff: "Min njiyataa cuɓal maa. Njokkee e line, min njaɓnataa e ballal.",
};

export const IVR_CONNECT_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Veuillez patienter pendant que nous vous connectons à notre équipe de support.",
  en: "Please wait while we connect you to our support team.",
  es: "Espere mientras lo conectamos con nuestro equipo de soporte.",
  ar: "يرجى الانتظار بينما نوصلك بفريق الدعم.",
  zh: "请稍候，正在为您接通支持团队。",
  ff: "Njokkee seɗɗa haa min njaɓnataa e kippu ballal amen.",
};

export const IVR_NO_ANSWER_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Tous nos représentants sont actuellement indisponibles. Veuillez laisser un message ou rappeler plus tard.",
  en: "All of our support representatives are currently unavailable. Please leave a message or try again later.",
  es: "Todos nuestros representantes no están disponibles actualmente. Deje un mensaje o llame más tarde.",
  ar: "جميع ممثلي الدعم غير متاحين حالياً. يرجى ترك رسالة أو الاتصال لاحقاً.",
  zh: "目前所有支持代表均不可用。请留言或稍后再拨。",
  ff: "Wakiiliiɓe ballal fof ɓe keɓotaako jooni. Accu mesaaʒ walla noddu kadi caggal.",
};

export const IVR_GOODBYE_PROMPT: Record<IvrVoiceLocale, string> = {
  fr: "Merci d'avoir appelé MMD Delivery. Au revoir.",
  en: "Thank you for calling MMD Delivery. Goodbye.",
  es: "Gracias por llamar a MMD Delivery. Adiós.",
  ar: "شكراً لاتصالك بـ MMD Delivery. مع السلامة.",
  zh: "感谢致电 MMD Delivery。再见。",
  ff: "A jaaraama noddude MMD Delivery. Ɓallee.",
};

/** @deprecated bilingual FR+EN prompt — kept for test migration references */
export const IVR_MENU_PROMPT: Record<"fr" | "en", string> = {
  fr: IVR_SERVICE_MENU_PROMPT.fr,
  en: IVR_SERVICE_MENU_PROMPT.en,
};

export type IvrStep = "language" | "service";

export type IvrLanguageDecision =
  | { action: "set_locale"; digit: string; locale: IvrVoiceLocale }
  | { action: "repeat"; attempt: number; invalid: boolean };

export type IvrGatherDecision =
  | { action: "connect"; digit: string; service: AdminVoiceService }
  | { action: "fallback"; digit: "0"; service: "general" }
  | { action: "repeat"; attempt: number; invalid: boolean };

export function parseIvrLocale(
  value: string | null | undefined,
): IvrVoiceLocale | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if ((IVR_SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as IvrVoiceLocale;
  }
  return null;
}

export function parseIvrStep(value: string | null | undefined): IvrStep {
  return String(value ?? "").trim().toLowerCase() === "service"
    ? "service"
    : "language";
}

/** @deprecated use IVR_SUPPORTED_LOCALES — language is chosen per call, not via env blend */
export function getIvrVoiceLocales(
  raw = process.env.MMD_VOICE_IVR_LOCALES,
): IvrVoiceLocale[] {
  const parsed = String(raw ?? "fr,en,es,ar,zh,ff")
    .split(",")
    .map((part) => part.trim().toLowerCase().slice(0, 2))
    .map((part) => parseIvrLocale(part))
    .filter((part): part is IvrVoiceLocale => Boolean(part));
  return parsed.length > 0 ? parsed : [...IVR_SUPPORTED_LOCALES];
}

function ivrSay(locale: IvrVoiceLocale, text: string): string {
  const { voice, language } = IVR_TWILIO_VOICE[locale];
  return `<Say voice="${voice}" language="${language}">${escapeTwiml(text)}</Say>`;
}

function ivrLanguageMenuSayBlocks(): string {
  return IVR_SUPPORTED_LOCALES.map((locale) =>
    ivrSay(locale, IVR_LANGUAGE_MENU_LINES[locale]),
  ).join("\n    ");
}

function ivrLanguageInvalidSayBlocks(): string {
  return IVR_SUPPORTED_LOCALES.map((locale) =>
    ivrSay(locale, IVR_LANGUAGE_INVALID_LINES[locale]),
  ).join("\n    ");
}

export function getTwilioVoiceIvrUrl(params: {
  step: IvrStep;
  attempt?: number;
  locale?: IvrVoiceLocale | null;
}): string {
  const base = getTwilioVoiceIvrBaseUrl();
  const url = new URL(base);
  url.searchParams.set("step", params.step);
  url.searchParams.set("attempt", String(Math.max(0, params.attempt ?? 0)));
  if (params.locale) {
    url.searchParams.set("locale", params.locale);
  }
  return url.toString();
}

export function parseIvrAttempt(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 9);
}

export function resolveIvrLocaleDigit(
  digits: string | null | undefined,
): { digit: string; locale: IvrVoiceLocale } | null {
  const digit = String(digits ?? "").trim().slice(-1);
  const locale = IVR_DIGIT_TO_LOCALE[digit as keyof typeof IVR_DIGIT_TO_LOCALE];
  if (!locale) return null;
  return { digit, locale };
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

export function decideIvrLanguageGather(params: {
  digits: string | null | undefined;
  attempt: number;
}): IvrLanguageDecision {
  const raw = String(params.digits ?? "").trim();
  const resolved = resolveIvrLocaleDigit(params.digits);
  if (resolved) {
    return {
      action: "set_locale",
      digit: resolved.digit,
      locale: resolved.locale,
    };
  }

  if (raw.length > 0) {
    return { action: "repeat", attempt: params.attempt, invalid: true };
  }

  // Never assume English — keep repeating the language menu.
  const nextAttempt =
    params.attempt >= MAX_IVR_EMPTY_ATTEMPTS
      ? params.attempt
      : params.attempt + 1;
  return { action: "repeat", attempt: nextAttempt, invalid: false };
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

/** Incoming support calls always start on the language menu. */
export function buildIvrLanguageGatherTwiml(params: {
  attempt: number;
  invalid?: boolean;
}): string {
  const actionUrl = getTwilioVoiceIvrUrl({
    step: "language",
    attempt: params.attempt,
  });
  const intro = params.invalid ? ivrLanguageInvalidSayBlocks() : "";

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
    ${ivrLanguageMenuSayBlocks()}
  </Gather>
</Response>
  `.trim();
}

/** @deprecated alias — public entry always starts with language selection */
export function buildIvrGatherTwiml(params: {
  attempt: number;
  invalid?: boolean;
  locale?: IvrVoiceLocale | null;
}): string {
  if (params.locale) {
    return buildIvrServiceGatherTwiml({
      locale: params.locale,
      attempt: params.attempt,
      invalid: params.invalid,
    });
  }
  return buildIvrLanguageGatherTwiml(params);
}

export function buildIvrServiceGatherTwiml(params: {
  locale: IvrVoiceLocale;
  attempt: number;
  invalid?: boolean;
}): string {
  const locale = params.locale;
  const actionUrl = getTwilioVoiceIvrUrl({
    step: "service",
    attempt: params.attempt,
    locale,
  });
  const intro = params.invalid ? ivrSay(locale, IVR_INVALID_PROMPT[locale]) : "";

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
    ${ivrSay(locale, IVR_SERVICE_MENU_PROMPT[locale])}
  </Gather>
</Response>
  `.trim();
}

export function ivrConnectPrefixSay(
  locale: IvrVoiceLocale,
  fallback?: boolean,
): string {
  const prefix = fallback ? IVR_TIMEOUT_FALLBACK_PROMPT : IVR_CONNECT_PROMPT;
  return prefix[locale];
}

export function buildIvrConnectTwiml(params: {
  service: AdminVoiceService;
  destPhone: string;
  locale: IvrVoiceLocale;
  fallback?: boolean;
}): string {
  const voice = IVR_TWILIO_VOICE[params.locale];
  return buildAdminDialTwiml({
    destPhone: params.destPhone,
    includeWelcome: false,
    prefixSay: ivrConnectPrefixSay(params.locale, params.fallback),
    sayVoice: voice.voice,
    sayLanguage: voice.language,
    noAnswerSay: IVR_NO_ANSWER_PROMPT[params.locale],
  });
}

export function buildIvrConferenceConnectTwiml(params: {
  conferenceName: string;
  locale: IvrVoiceLocale;
  fallback?: boolean;
}): string {
  const voice = IVR_TWILIO_VOICE[params.locale];
  return buildConferenceJoinTwiml({
    conferenceName: params.conferenceName,
    startOnEnter: true,
    endOnExit: true,
    prefixSay: ivrConnectPrefixSay(params.locale, params.fallback),
    sayVoice: voice.voice,
    sayLanguage: voice.language,
  });
}

export function buildIvrUnavailableTwiml(locale: IvrVoiceLocale = "en"): string {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${ivrSay(locale, IVR_NO_ANSWER_PROMPT[locale])}
  <Record
    maxLength="180"
    playBeep="true"
    transcribe="false"
    trim="trim-silence"
  />
  ${ivrSay(locale, IVR_GOODBYE_PROMPT[locale])}
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
