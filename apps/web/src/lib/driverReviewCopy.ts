import type { TransactionalEmailTemplate } from "./transactionalEmailTemplates";
import { normalizeAppLocale, type AppLocale } from "./userLocale";
import type { DriverReviewTarget } from "./driverReviewTransition";

export const DRIVER_HOME_URL = "https://mmddelivery.com/orders/driver";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type LocaleCopy = {
  subject: string;
  preview: string;
  headline: string;
  body: string;
  cta: string;
};

function email(
  locale: AppLocale,
  copy: Record<AppLocale, LocaleCopy>,
  extraHtml = "",
): TransactionalEmailTemplate {
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${escapeHtml(t.body)}</p>${extraHtml}`,
    ctaLabel: t.cta,
    ctaUrl: DRIVER_HOME_URL,
  };
}

export function driverRejectedEmail(params: {
  locale?: AppLocale | string | null;
  reason?: string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params?.locale);
  const reason = String(params.reason ?? "").trim();
  const reasonHtml = reason
    ? `<p><strong>${escapeHtml(reasonLabel(locale))}</strong> ${escapeHtml(reason)}</p>`
    : "";
  return email(
    locale,
    {
      en: {
        subject: "Driver application rejected",
        preview: "Your driver application was rejected.",
        headline: "Application rejected",
        body: "Your driver application was rejected. Driver Home stays closed until you correct the application and a new review is approved.",
        cta: "Open driver account",
      },
      fr: {
        subject: "Dossier chauffeur rejeté",
        preview: "Votre dossier chauffeur a été rejeté.",
        headline: "Dossier rejeté",
        body: "Votre dossier chauffeur a été rejeté. L'accueil chauffeur reste fermé tant que vous n'avez pas corrigé le dossier et qu'une nouvelle revue n'est pas approuvée.",
        cta: "Ouvrir le compte chauffeur",
      },
      es: {
        subject: "Solicitud de conductor rechazada",
        preview: "Tu solicitud de conductor fue rechazada.",
        headline: "Solicitud rechazada",
        body: "Tu solicitud de conductor fue rechazada. El inicio del conductor permanece cerrado hasta que corrijas la solicitud y una nueva revisión sea aprobada.",
        cta: "Abrir cuenta de conductor",
      },
      ar: {
        subject: "تم رفض طلب السائق",
        preview: "تم رفض طلب السائق.",
        headline: "تم رفض الملف",
        body: "تم رفض ملف السائق. تبقى الصفحة الرئيسية مغلقة إلى أن تصحّح الملف وتُقبل مراجعة جديدة.",
        cta: "فتح حساب السائق",
      },
      zh: {
        subject: "司机申请已拒绝",
        preview: "您的司机申请已被拒绝。",
        headline: "申请已拒绝",
        body: "您的司机申请已被拒绝。在您更正申请且新的审核通过之前，司机首页保持关闭。",
        cta: "打开司机账户",
      },
      ff: {
        subject: "Dossier driwer salaama",
        preview: "Dossier driwer maa salaama.",
        headline: "Dossier salaama",
        body: "Dossier driwer maa salaama. Jaɓɓorgo driwer udditataa haa a moƴƴina dossier oo, kadi ƴeewndo hesere jaɓee.",
        cta: "Uddit konte driwer",
      },
    },
    `${reasonHtml}<p>${escapeHtml(nextStep(locale))}</p>`,
  );
}

export function driverSuspendedEmail(params: {
  locale?: AppLocale | string | null;
  reason?: string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params?.locale);
  const reason = String(params.reason ?? "").trim();
  const reasonHtml = reason
    ? `<p><strong>${escapeHtml(reasonLabel(locale))}</strong> ${escapeHtml(reason)}</p>`
    : "";
  return email(
    locale,
    {
      en: {
        subject: "Driver account suspended",
        preview: "Your driver account is suspended.",
        headline: "Account suspended",
        body: "Your driver account is suspended. Driver Home is closed until MMD Delivery reactivates the account.",
        cta: "Open driver account",
      },
      fr: {
        subject: "Compte chauffeur suspendu",
        preview: "Votre compte chauffeur est suspendu.",
        headline: "Compte suspendu",
        body: "Votre compte chauffeur est suspendu. L'accueil chauffeur est fermé tant que MMD Delivery ne réactive pas le compte.",
        cta: "Ouvrir le compte chauffeur",
      },
      es: {
        subject: "Cuenta de conductor suspendida",
        preview: "Tu cuenta de conductor está suspendida.",
        headline: "Cuenta suspendida",
        body: "Tu cuenta de conductor está suspendida. El inicio del conductor permanece cerrado hasta que MMD Delivery reactive la cuenta.",
        cta: "Abrir cuenta de conductor",
      },
      ar: {
        subject: "تم تعليق حساب السائق",
        preview: "حساب السائق معلّق.",
        headline: "الحساب معلّق",
        body: "حساب السائق معلّق. الصفحة الرئيسية مغلقة إلى أن يعيد MMD Delivery تفعيل الحساب.",
        cta: "فتح حساب السائق",
      },
      zh: {
        subject: "司机账户已暂停",
        preview: "您的司机账户已暂停。",
        headline: "账户已暂停",
        body: "您的司机账户已暂停。在 MMD Delivery 重新启用之前，司机首页保持关闭。",
        cta: "打开司机账户",
      },
      ff: {
        subject: "Konte driwer sabbinaama",
        preview: "Konte driwer maa sabbinaama.",
        headline: "Konte sabbinaama",
        body: "Konte driwer maa sabbinaama. Jaɓɓorgo driwer udditataa haa MMD Delivery hurmina konte ndee.",
        cta: "Uddit konte driwer",
      },
    },
    reasonHtml,
  );
}

export function driverDisabledEmail(params: {
  locale?: AppLocale | string | null;
  reason?: string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params?.locale);
  const reason = String(params.reason ?? "").trim();
  const reasonHtml = reason
    ? `<p><strong>${escapeHtml(reasonLabel(locale))}</strong> ${escapeHtml(reason)}</p>`
    : "";
  return email(
    locale,
    {
      en: {
        subject: "Driver account disabled",
        preview: "Your driver account is disabled.",
        headline: "Account disabled",
        body: "Your driver account is disabled. Driver Home is closed. Contact MMD Delivery support if you need help.",
        cta: "Open driver account",
      },
      fr: {
        subject: "Compte chauffeur désactivé",
        preview: "Votre compte chauffeur est désactivé.",
        headline: "Compte désactivé",
        body: "Votre compte chauffeur est désactivé. L'accueil chauffeur est fermé. Contactez le support MMD Delivery si vous avez besoin d'aide.",
        cta: "Ouvrir le compte chauffeur",
      },
      es: {
        subject: "Cuenta de conductor desactivada",
        preview: "Tu cuenta de conductor está desactivada.",
        headline: "Cuenta desactivada",
        body: "Tu cuenta de conductor está desactivada. El inicio del conductor está cerrado. Contacta al soporte de MMD Delivery si necesitas ayuda.",
        cta: "Abrir cuenta de conductor",
      },
      ar: {
        subject: "تم تعطيل حساب السائق",
        preview: "حساب السائق معطّل.",
        headline: "الحساب معطّل",
        body: "حساب السائق معطّل. الصفحة الرئيسية مغلقة. تواصل مع دعم MMD Delivery إذا احتجت مساعدة.",
        cta: "فتح حساب السائق",
      },
      zh: {
        subject: "司机账户已停用",
        preview: "您的司机账户已停用。",
        headline: "账户已停用",
        body: "您的司机账户已停用。司机首页已关闭。如需帮助，请联系 MMD Delivery 支持。",
        cta: "打开司机账户",
      },
      ff: {
        subject: "Konte driwer dartinaama",
        preview: "Konte driwer maa dartinaama.",
        headline: "Konte dartinaama",
        body: "Konte driwer maa dartinaama. Jaɓɓorgo driwer uddaama. Jokkondir e support MMD Delivery so a sokli ballal.",
        cta: "Uddit konte driwer",
      },
    },
    reasonHtml,
  );
}

export function driverReviewRequestedEmail(params: {
  locale?: AppLocale | string | null;
  driverName?: string | null;
  reviewUrl: string;
  resubmission?: boolean;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const name = escapeHtml(displayName(params.driverName, locale));
  const href = params.reviewUrl;
  const copy = params.resubmission
    ? resubmitReviewCopy(name)
    : newReviewCopy(name);
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.body}</p>`,
    ctaLabel: t.cta,
    ctaUrl: href,
  };
}

export function driverDecisionPush(
  status: DriverReviewTarget,
  localeRaw: AppLocale | string | null | undefined,
  reason?: string | null,
): { title: string; body: string } {
  const locale = normalizeAppLocale(localeRaw);
  const base = PUSH[status][locale];
  const clean = String(reason ?? "").trim().slice(0, 120);
  if (!clean || status === "approved") return base;
  return { title: base.title, body: `${base.body} ${clean}` };
}

function reasonLabel(locale: AppLocale): string {
  const labels: Record<AppLocale, string> = {
    en: "Reason",
    fr: "Raison",
    es: "Motivo",
    ar: "السبب",
    zh: "原因",
    ff: "Daliilu",
  };
  return labels[locale];
}

function nextStep(locale: AppLocale): string {
  const steps: Record<AppLocale, string> = {
    en: "Update the rejected information, then submit the same application again.",
    fr: "Corrigez les informations rejetées, puis renvoyez le même dossier.",
    es: "Corrige la información rechazada y vuelve a enviar la misma solicitud.",
    ar: "صحّح المعلومات المرفوضة ثم أعد إرسال الملف نفسه.",
    zh: "请更正被拒绝的信息，然后重新提交同一份申请。",
    ff: "Moƴƴin kabaruuji salaama, ndeen neldu dossier oo kadi.",
  };
  return steps[locale];
}

function displayName(name: string | null | undefined, locale: AppLocale): string {
  const clean = String(name ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (clean) return clean;
  const fallback: Record<AppLocale, string> = {
    en: "A driver",
    fr: "Un chauffeur",
    es: "Un conductor",
    ar: "سائق",
    zh: "一名司机",
    ff: "Driwer",
  };
  return fallback[locale];
}

function newReviewCopy(name: string): Record<AppLocale, LocaleCopy> {
  return {
    en: {
      subject: "New driver application to review",
      preview: "A driver application is waiting for review.",
      headline: "Driver review required",
      body: `${name} submitted a driver application. Action is required.`,
      cta: "Open the application",
    },
    fr: {
      subject: "Nouveau dossier chauffeur à examiner",
      preview: "Un dossier chauffeur attend une revue.",
      headline: "Revue chauffeur requise",
      body: `${name} a envoyé un dossier chauffeur. Une action est requise.`,
      cta: "Ouvrir le dossier",
    },
    es: {
      subject: "Nueva solicitud de conductor por revisar",
      preview: "Una solicitud de conductor espera revisión.",
      headline: "Revisión de conductor requerida",
      body: `${name} envió una solicitud de conductor. Se requiere una acción.`,
      cta: "Abrir la solicitud",
    },
    ar: {
      subject: "طلب سائق جديد بانتظار المراجعة",
      preview: "طلب سائق بانتظار المراجعة.",
      headline: "مراجعة السائق مطلوبة",
      body: `أرسل ${name} طلب سائق. الإجراء مطلوب.`,
      cta: "فتح الملف",
    },
    zh: {
      subject: "有新的司机申请待审核",
      preview: "一份司机申请正在等待审核。",
      headline: "需要审核司机",
      body: `${name} 提交了司机申请。需要处理。`,
      cta: "打开申请",
    },
    ff: {
      subject: "Dossier driwer keso ina sabbii ƴeewndo",
      preview: "Dossier driwer ina sabbii ƴeewndo.",
      headline: "Ƴeewndo driwer ena haani",
      body: `${name} neldi dossier driwer. Gollal ena haani.`,
      cta: "Uddit dossier",
    },
  };
}

function resubmitReviewCopy(name: string): Record<AppLocale, LocaleCopy> {
  return {
    en: {
      subject: "Driver application submitted again",
      preview: "A rejected driver application is pending again.",
      headline: "Driver review required again",
      body: `${name} corrected the application and submitted it again. A new review is required.`,
      cta: "Open the application",
    },
    fr: {
      subject: "Dossier chauffeur renvoyé",
      preview: "Un dossier chauffeur rejeté est de nouveau en attente.",
      headline: "Nouvelle revue chauffeur requise",
      body: `${name} a corrigé le dossier et l'a renvoyé. Une nouvelle revue est requise.`,
      cta: "Ouvrir le dossier",
    },
    es: {
      subject: "Solicitud de conductor enviada de nuevo",
      preview: "Una solicitud rechazada vuelve a estar pendiente.",
      headline: "Nueva revisión de conductor requerida",
      body: `${name} corrigió la solicitud y la envió de nuevo. Se requiere una nueva revisión.`,
      cta: "Abrir la solicitud",
    },
    ar: {
      subject: "أُعيد إرسال طلب السائق",
      preview: "طلب مرفوض عاد إلى الانتظار.",
      headline: "مراجعة السائق مطلوبة من جديد",
      body: `صحّح ${name} الملف وأعاده. مراجعة جديدة مطلوبة.`,
      cta: "فتح الملف",
    },
    zh: {
      subject: "司机申请已重新提交",
      preview: "一份被拒绝的司机申请再次待审核。",
      headline: "需要再次审核司机",
      body: `${name} 已更正并重新提交申请。需要新的审核。`,
      cta: "打开申请",
    },
    ff: {
      subject: "Dossier driwer neldii kadi",
      preview: "Dossier driwer salaaɗo woni kadi e sabbu.",
      headline: "Ƴeewndo driwer ena haani kadi",
      body: `${name} moƴƴinii dossier oo, neldi ɗum kadi. Ƴeewndo hesere ena haani.`,
      cta: "Uddit dossier",
    },
  };
}

const PUSH: Record<DriverReviewTarget, Record<AppLocale, { title: string; body: string }>> = {
  approved: {
    en: { title: "Driver account approved", body: "Your driver account was approved. You can open Driver Home." },
    fr: { title: "Compte chauffeur approuvé", body: "Votre compte chauffeur est approuvé. Vous pouvez ouvrir l'accueil chauffeur." },
    es: { title: "Cuenta de conductor aprobada", body: "Tu cuenta de conductor fue aprobada. Puedes abrir el inicio del conductor." },
    ar: { title: "تمت الموافقة على حساب السائق", body: "تمت الموافقة على حساب السائق. يمكنك فتح الصفحة الرئيسية." },
    zh: { title: "司机账户已通过", body: "您的司机账户已通过。可以进入司机首页。" },
    ff: { title: "Konte driwer jaɓaama", body: "Konte driwer maa jaɓaama. A waawi udditde jaɓɓorgo driwer." },
  },
  rejected: {
    en: { title: "Application rejected", body: "Your driver application was rejected. Open the app to see the reason and submit again." },
    fr: { title: "Dossier rejeté", body: "Votre dossier chauffeur a été rejeté. Ouvrez l'application pour voir la raison et renvoyer le dossier." },
    es: { title: "Solicitud rechazada", body: "Tu solicitud de conductor fue rechazada. Abre la aplicación para ver el motivo y enviarla de nuevo." },
    ar: { title: "تم رفض الملف", body: "تم رفض ملف السائق. افتح التطبيق لرؤية السبب وإعادة الإرسال." },
    zh: { title: "申请已拒绝", body: "您的司机申请已被拒绝。请打开应用查看原因并重新提交。" },
    ff: { title: "Dossier salaama", body: "Dossier driwer maa salaama. Uddit jaaɓnirgal ngam yiyde daliilu e neldude kadi." },
  },
  suspended: {
    en: { title: "Account suspended", body: "Your driver account is suspended. Driver Home is closed." },
    fr: { title: "Compte suspendu", body: "Votre compte chauffeur est suspendu. L'accueil chauffeur est fermé." },
    es: { title: "Cuenta suspendida", body: "Tu cuenta de conductor está suspendida. El inicio del conductor está cerrado." },
    ar: { title: "الحساب معلّق", body: "حساب السائق معلّق. الصفحة الرئيسية مغلقة." },
    zh: { title: "账户已暂停", body: "您的司机账户已暂停。司机首页已关闭。" },
    ff: { title: "Konte sabbinaama", body: "Konte driwer maa sabbinaama. Jaɓɓorgo driwer uddaama." },
  },
  disabled: {
    en: { title: "Account disabled", body: "Your driver account is disabled. Driver Home is closed." },
    fr: { title: "Compte désactivé", body: "Votre compte chauffeur est désactivé. L'accueil chauffeur est fermé." },
    es: { title: "Cuenta desactivada", body: "Tu cuenta de conductor está desactivada. El inicio del conductor está cerrado." },
    ar: { title: "الحساب معطّل", body: "حساب السائق معطّل. الصفحة الرئيسية مغلقة." },
    zh: { title: "账户已停用", body: "您的司机账户已停用。司机首页已关闭。" },
    ff: { title: "Konte dartinaama", body: "Konte driwer maa dartinaama. Jaɓɓorgo driwer uddaama." },
  },
};
