import {
  MMD_SMS_CTA_URL,
  MMD_SMS_PROGRAM_NAME,
  MMD_SMS_SUPPORT_EMAIL,
  MMD_SMS_SUPPORT_PHONE_DISPLAY,
  MMD_SMS_SUPPORT_URL,
} from "./smsA2p";

export type SmsTemplateId =
  | "order_dispatched"
  | "order_delivered"
  | "package_dispatched"
  | "taxi_dispatched"
  | "support"
  | "opt_in_confirm"
  | "help"
  | "stop_confirm"
  | "start_confirm"
  | "start_needs_cta";

const RATES_STOP = "Msg & data rates may apply. Reply STOP to cancel, HELP for help.";

function shortRef(id: string): string {
  return String(id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
}

export function renderSmsTemplate(
  id: SmsTemplateId,
  vars: { ref?: string } = {},
): string {
  const ref = vars.ref ? shortRef(vars.ref) : "";

  switch (id) {
    case "order_dispatched":
      return `${MMD_SMS_PROGRAM_NAME}: Your order #${ref} is on the way. Track it in the MMD Delivery app. ${RATES_STOP}`;
    case "order_delivered":
      return `${MMD_SMS_PROGRAM_NAME}: Your order #${ref} was delivered. ${RATES_STOP}`;
    case "package_dispatched":
      return `${MMD_SMS_PROGRAM_NAME}: A driver is on the way for your package delivery #${ref}. Track it in the app. ${RATES_STOP}`;
    case "taxi_dispatched":
      return `${MMD_SMS_PROGRAM_NAME}: Your driver is on the way for ride #${ref}. Track your ride in the app. ${RATES_STOP}`;
    case "support":
      return `${MMD_SMS_PROGRAM_NAME}: We received your support request. ${MMD_SMS_SUPPORT_EMAIL} or ${MMD_SMS_SUPPORT_URL}. ${RATES_STOP}`;
    case "opt_in_confirm":
      return `${MMD_SMS_PROGRAM_NAME}: You are opted in to informational texts about your account, orders, deliveries, rides, and support. ${RATES_STOP}`;
    case "help":
      return `${MMD_SMS_PROGRAM_NAME}: Help — ${MMD_SMS_SUPPORT_EMAIL}, ${MMD_SMS_SUPPORT_URL}, ${MMD_SMS_SUPPORT_PHONE_DISPLAY}. Msg & data rates may apply. Reply STOP to cancel.`;
    case "stop_confirm":
      return `${MMD_SMS_PROGRAM_NAME}: You are opted out and will no longer receive SMS. Reply START only if you previously opted in, or visit ${MMD_SMS_CTA_URL}.`;
    case "start_confirm":
      return `${MMD_SMS_PROGRAM_NAME}: You are opted back in to informational texts. ${RATES_STOP}`;
    case "start_needs_cta":
      return `${MMD_SMS_PROGRAM_NAME}: We could not confirm a prior SMS opt-in for this number. Opt in at ${MMD_SMS_CTA_URL}`;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/** Representative A2P sample — must match templates that the Messages API actually sends. */
export const A2P_SAMPLE_MESSAGES = [
  renderSmsTemplate("order_dispatched", { ref: "A1B2C3D4" }),
  renderSmsTemplate("order_delivered", { ref: "A1B2C3D4" }),
  renderSmsTemplate("taxi_dispatched", { ref: "E5F6G7H8" }),
  renderSmsTemplate("package_dispatched", { ref: "P9Q0R1S2" }),
  renderSmsTemplate("opt_in_confirm"),
] as const;
