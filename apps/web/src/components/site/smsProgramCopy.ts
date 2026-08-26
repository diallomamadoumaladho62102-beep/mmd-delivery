import {
  MMD_SMS_PRIVACY_URL,
  MMD_SMS_SUPPORT_EMAIL,
  MMD_SMS_SUPPORT_PHONE_DISPLAY,
  MMD_SMS_SUPPORT_URL,
  MMD_SMS_TERMS_URL,
} from "@/lib/smsA2p";

export const SMS_PROGRAM_SEO = {
  title: "MMD Delivery SMS program — opt in",
  description:
    "Opt in to informational and transactional text messages from MMD Delivery. Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for help.",
  robots: "index,follow",
} as const;

export const SMS_CONSENT_DEFAULT = false;

export const SMS_CONSENT_CHECKBOX_EN =
  "I agree to receive automated informational and transactional text messages from MMD Delivery about my account, verification, orders, deliveries, package deliveries, taxi rides, and customer support. Message frequency varies. Message and data rates may apply. Consent is not a condition of purchase. Reply STOP to cancel and HELP for help.";

export const SMS_CONSENT_CHECKBOX_FR =
  "J’accepte de recevoir des SMS automatisés d’information et de transaction de MMD Delivery concernant mon compte, la vérification, les commandes, les livraisons, les colis, les courses taxi et le support. La fréquence des messages varie. Des frais de messages et de données peuvent s’appliquer. Le consentement n’est pas une condition d’achat. Répondez STOP pour vous désinscrire et HELP pour obtenir de l’aide.";

export type SmsProgramLocale = "en" | "fr";

export type SmsProgramCopy = {
  locale: SmsProgramLocale;
  eyebrow: string;
  headline: string;
  intro: string;
  whoTitle: string;
  whoBody: string;
  whatTitle: string;
  whatItems: string[];
  frequencyTitle: string;
  frequencyBody: string;
  consentTitle: string;
  consentBody: string;
  ratesTitle: string;
  ratesBody: string;
  stopTitle: string;
  stopBody: string;
  helpTitle: string;
  helpBody: string;
  legalTitle: string;
  checkboxLabel: string;
  phoneLabel: string;
  phonePlaceholder: string;
  submitLabel: string;
  successTitle: string;
  successBody: string;
  errorConsent: string;
  errorPhone: string;
  errorGeneric: string;
  optionalNote: string;
  privacyLabel: string;
  termsLabel: string;
  supportLabel: string;
};

export const SMS_PROGRAM_COPY: Record<SmsProgramLocale, SmsProgramCopy> = {
  en: {
    locale: "en",
    eyebrow: "MMD Delivery messaging program",
    headline: "Text messages from MMD Delivery",
    intro:
      "This page is the public Call to Action for the MMD Delivery SMS program. No account, app, or purchase is required to review or submit this opt-in.",
    whoTitle: "Who receives texts",
    whoBody:
      "Only the mobile number you enter here, or a number you later opt in from the MMD Delivery website or app. Creating an account or typing a phone number is not consent.",
    whatTitle: "What we send",
    whatItems: [
      "Account and phone-verification notices when you request them",
      "Order and food-delivery updates",
      "Package-delivery updates",
      "Taxi ride updates",
      "Customer-support follow-up when relevant",
    ],
    frequencyTitle: "Message frequency",
    frequencyBody:
      "Message frequency varies. You may receive a verification text when you request one, and a few messages when an order, delivery, or ride is assigned or completed. There is no fixed daily number.",
    consentTitle: "Consent",
    consentBody:
      "Consent is optional and separate from Terms and Privacy. The checkbox below is unchecked by default. You can use MMD Delivery without SMS. Consent is not a condition of purchase.",
    ratesTitle: "Rates",
    ratesBody: "Message and data rates may apply.",
    stopTitle: "STOP",
    stopBody:
      "Reply STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT to any MMD Delivery text. You will receive a confirmation and we will stop SMS to that number unless you opt in again.",
    helpTitle: "HELP",
    helpBody: `Reply HELP, email ${MMD_SMS_SUPPORT_EMAIL}, call ${MMD_SMS_SUPPORT_PHONE_DISPLAY}, or visit ${MMD_SMS_SUPPORT_URL}.`,
    legalTitle: "Legal",
    checkboxLabel: SMS_CONSENT_CHECKBOX_EN,
    phoneLabel: "Mobile number",
    phonePlaceholder: "+1 929 000 0000",
    submitLabel: "Agree and opt in to SMS",
    successTitle: "You opted in to MMD Delivery SMS",
    successBody:
      "We saved your explicit consent for informational and transactional texts. You can reply STOP at any time. Confirmation texts are sent only after A2P approval.",
    errorConsent: "Check the SMS consent box to opt in. It is optional — leave it unchecked if you do not want texts.",
    errorPhone: "Enter a valid mobile number.",
    errorGeneric: "We could not save your SMS consent. Try again.",
    optionalNote: "This checkbox is optional and is not checked by default.",
    privacyLabel: "Privacy Policy",
    termsLabel: "Terms of Service",
    supportLabel: "Support",
  },
  fr: {
    locale: "fr",
    eyebrow: "Programme de messages MMD Delivery",
    headline: "SMS de MMD Delivery",
    intro:
      "Cette page est l’appel à l’action public du programme SMS MMD Delivery. Aucun compte, application ou achat n’est requis pour la consulter ou donner votre consentement.",
    whoTitle: "Qui reçoit les SMS",
    whoBody:
      "Uniquement le numéro que vous saisissez ici, ou un numéro pour lequel vous optez plus tard sur le site ou dans l’application. Créer un compte ou fournir un numéro n’est pas un consentement.",
    whatTitle: "Quels SMS nous envoyons",
    whatItems: [
      "Avis de compte et de vérification téléphone lorsque vous les demandez",
      "Mises à jour de commandes et de livraisons repas",
      "Mises à jour de livraisons de colis",
      "Mises à jour de courses taxi",
      "Suivi support client lorsque c’est pertinent",
    ],
    frequencyTitle: "Fréquence",
    frequencyBody:
      "La fréquence des messages varie. Vous pouvez recevoir un SMS de vérification lorsque vous le demandez, et quelques messages lorsqu’une commande, une livraison ou une course est assignée ou terminée.",
    consentTitle: "Consentement",
    consentBody:
      "Le consentement est facultatif et séparé des Conditions et de la Confidentialité. La case ci-dessous n’est pas cochée par défaut. Vous pouvez utiliser MMD Delivery sans SMS. Le consentement n’est pas une condition d’achat.",
    ratesTitle: "Tarifs",
    ratesBody: "Des frais de messages et de données peuvent s’appliquer.",
    stopTitle: "STOP",
    stopBody:
      "Répondez STOP, STOPALL, UNSUBSCRIBE, CANCEL, END ou QUIT à n’importe quel SMS MMD Delivery. Vous recevrez une confirmation et nous n’enverrons plus de SMS à ce numéro tant que vous ne vous réinscrivez pas.",
    helpTitle: "HELP",
    helpBody: `Répondez HELP, écrivez à ${MMD_SMS_SUPPORT_EMAIL}, appelez le ${MMD_SMS_SUPPORT_PHONE_DISPLAY}, ou consultez ${MMD_SMS_SUPPORT_URL}.`,
    legalTitle: "Mentions légales",
    checkboxLabel: SMS_CONSENT_CHECKBOX_FR,
    phoneLabel: "Numéro de mobile",
    phonePlaceholder: "+1 929 000 0000",
    submitLabel: "Accepter et m’inscrire aux SMS",
    successTitle: "Vous êtes inscrit aux SMS MMD Delivery",
    successBody:
      "Nous avons enregistré votre consentement explicite pour les SMS d’information et de transaction. Répondez STOP à tout moment. Un SMS de confirmation n’est envoyé qu’après approbation A2P.",
    errorConsent:
      "Cochez la case de consentement SMS pour vous inscrire. Elle est facultative — laissez-la décochée si vous ne voulez pas de SMS.",
    errorPhone: "Saisissez un numéro de mobile valide.",
    errorGeneric: "Impossible d’enregistrer le consentement SMS. Réessayez.",
    optionalNote: "Cette case est facultative et n’est pas cochée par défaut.",
    privacyLabel: "Politique de confidentialité",
    termsLabel: "Conditions d’utilisation",
    supportLabel: "Assistance",
  },
};

export const SMS_LEGAL_LINKS = {
  privacy: MMD_SMS_PRIVACY_URL,
  terms: MMD_SMS_TERMS_URL,
  support: MMD_SMS_SUPPORT_URL,
} as const;
