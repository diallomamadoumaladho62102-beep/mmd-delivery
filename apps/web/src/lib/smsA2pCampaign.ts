import { A2P_SAMPLE_MESSAGES } from "./smsTemplates";
import {
  MMD_SMS_CTA_URL,
  MMD_SMS_PRIVACY_URL,
  MMD_SMS_SUPPORT_EMAIL,
  MMD_SMS_SUPPORT_PHONE_DISPLAY,
  MMD_SMS_SUPPORT_URL,
  MMD_SMS_TERMS_URL,
} from "./smsA2p";
import { SMS_CONSENT_CHECKBOX_EN } from "@/components/site/smsProgramCopy";

export const A2P_CAMPAIGN_DESCRIPTION =
  "MMD Delivery sends low-volume informational and transactional SMS about account verification, food orders, package deliveries, taxi rides, and customer support. No marketing SMS.";

export const A2P_MESSAGE_FLOW = `End users opt in only through an explicit, unchecked SMS consent checkbox.

1. Open ${MMD_SMS_CTA_URL} (no login, no app, no purchase required). The page is available in English and French.
2. Read the MMD Delivery messaging program: message types, frequency varies, message and data rates may apply, Privacy, Terms, STOP, and HELP.
3. Enter a mobile number.
4. Check the optional box: "${SMS_CONSENT_CHECKBOX_EN}"
5. Submit. MMD Delivery stores the consent (when, how, where, program) and does not treat account creation or merely providing a phone number as consent.
6. The same optional unchecked checkbox is also offered on website/app signup and profile. It is never required to create an account or complete a purchase.
7. Privacy: ${MMD_SMS_PRIVACY_URL}
8. Terms: ${MMD_SMS_TERMS_URL}
9. Support: ${MMD_SMS_SUPPORT_URL} / ${MMD_SMS_SUPPORT_EMAIL} / ${MMD_SMS_SUPPORT_PHONE_DISPLAY}
10. Opt out: reply STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT. HELP replies with support contact details.
11. START restores SMS only if that number previously completed the explicit checkbox opt-in. START is not a primary Call to Action.

Keyword JOIN is not used.`;

export const A2P_SAMPLE_MESSAGE_LIST = [...A2P_SAMPLE_MESSAGES];
