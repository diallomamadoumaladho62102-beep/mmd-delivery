"use client";

import {
  CANCEL_NOTE_MAX,
  CANCEL_NOTE_MIN,
  cancellationReasonLabel,
  sanitizeCancelNote,
  type CancelLocale,
} from "@/lib/cancellationReasons";

const COPY: Record<
  CancelLocale,
  { title: string; describe: string; tooShort: string; confirm: string; cancel: string }
> = {
  en: {
    title: "Why are you cancelling?",
    describe: "Describe your reason",
    tooShort: "Enter at least 8 characters.",
    confirm: "Confirm cancellation",
    cancel: "Back",
  },
  fr: {
    title: "Pourquoi annulez-vous ?",
    describe: "Décrivez votre raison",
    tooShort: "Saisissez au moins 8 caractères.",
    confirm: "Confirmer l'annulation",
    cancel: "Retour",
  },
  es: {
    title: "¿Por qué cancelas?",
    describe: "Describe tu motivo",
    tooShort: "Escribe al menos 8 caracteres.",
    confirm: "Confirmar cancelación",
    cancel: "Volver",
  },
  ar: {
    title: "لماذا تلغي؟",
    describe: "صف سببك",
    tooShort: "أدخل 8 أحرف على الأقل.",
    confirm: "تأكيد الإلغاء",
    cancel: "رجوع",
  },
  zh: {
    title: "为什么要取消？",
    describe: "请描述原因",
    tooShort: "请至少输入 8 个字符。",
    confirm: "确认取消",
    cancel: "返回",
  },
  ff: {
    title: "Ko waɗi ka haaytiniri?",
    describe: "Siftin daliilu maa",
    tooShort: "Naatnu hay alkule 8.",
    confirm: "Teeŋtin haaytinirde",
    cancel: "Rutto",
  },
};

function browserLocale(): CancelLocale {
  const lang =
    typeof navigator === "undefined" ? "en" : navigator.language.slice(0, 2).toLowerCase();
  if (lang === "en" || lang === "fr" || lang === "es" || lang === "ar" || lang === "zh" || lang === "ff") {
    return lang;
  }
  return "en";
}

export function collectCancelReason(
  allowed: readonly string[],
  locale: CancelLocale = browserLocale(),
): Promise<{ reasonCode: string; reasonNote: string | null } | null> {
  const copy = COPY[locale];
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.style.cssText =
      "position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px;";

    const card = document.createElement("form");
    card.style.cssText =
      "width:min(420px,100%);background:#fff;color:#0f172a;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;";

    const title = document.createElement("h2");
    title.textContent = copy.title;
    title.style.cssText = "margin:0;font-size:18px;";

    const select = document.createElement("select");
    select.required = true;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = copy.title;
    select.appendChild(blank);
    for (const code of allowed) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = cancellationReasonLabel(code, locale);
      select.appendChild(option);
    }

    const label = document.createElement("label");
    label.textContent = copy.describe;
    label.hidden = true;
    const area = document.createElement("textarea");
    area.maxLength = CANCEL_NOTE_MAX;
    area.rows = 3;
    label.appendChild(area);

    const error = document.createElement("p");
    error.style.cssText = "margin:0;color:#b91c1c;font-size:13px;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = copy.cancel;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = copy.confirm;
    submit.disabled = true;
    actions.append(back, submit);
    card.append(title, select, label, error, actions);
    root.appendChild(card);
    document.body.appendChild(root);

    const finish = (value: { reasonCode: string; reasonNote: string | null } | null) => {
      root.remove();
      resolve(value);
    };

    const refresh = () => {
      const code = select.value;
      const note = sanitizeCancelNote(area.value);
      label.hidden = code !== "other";
      const valid = code.length > 0 && (code !== "other" || note.length >= CANCEL_NOTE_MIN);
      submit.disabled = !valid;
      error.textContent = code === "other" && note.length > 0 && note.length < CANCEL_NOTE_MIN ? copy.tooShort : "";
    };

    select.addEventListener("change", refresh);
    area.addEventListener("input", refresh);
    back.addEventListener("click", () => finish(null));
    root.addEventListener("click", (event) => {
      if (event.target === root) finish(null);
    });
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = select.value;
      const note = sanitizeCancelNote(area.value);
      if (!code || (code === "other" && note.length < CANCEL_NOTE_MIN)) {
        refresh();
        return;
      }
      finish({ reasonCode: code, reasonNote: code === "other" ? note : note || null });
    });
  });
}
