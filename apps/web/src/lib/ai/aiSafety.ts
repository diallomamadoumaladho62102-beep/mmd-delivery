const ESCALATION_KEYWORDS = [
  "refund",
  "remboursement",
  "dispute",
  "litige",
  "accident",
  "stolen",
  "volé",
  "harass",
  "harcèlement",
  "chargeback",
  "fraud",
  "fraude",
  "police",
  "emergency",
  "urgence",
  "injured",
  "blessé",
];

const BLOCKED_AUTO_ACTIONS = new Set([
  "payment",
  "cancel",
  "refund",
  "accept_mission",
  "reject_mission",
  "dispatch_modify",
  "order_modify",
  "price_change",
  "payout_change",
  "menu_delete",
  "restaurant_close",
  "create_taxi_ride",
  "book_taxi",
  "place_order",
  "create_food_order",
  "start_checkout",
  "confirm_paid",
  "confirm_taxi_paid",
  "initiate_payment",
  "cash_out",
]);

export type AiBlockedCategory =
  | "politics"
  | "sexual"
  | "crime"
  | "dangerous"
  | "private"
  | "competitor_ops"
  | "harassment"
  | "crypto";

export type AiGuardDecision =
  | { action: "allow" }
  | { action: "refuse"; category: AiBlockedCategory };

export type AiGuardHistoryTurn = {
  role?: string;
  content?: string;
};

/** Canonical French refusal — also used as the default copy. */
export const AI_REFUSAL_MESSAGE =
  "Je suis MMD AI. Je peux vous aider avec MMD Delivery, des sujets éducatifs, religieux, des informations générales utiles et la recherche de lieux publics. Je ne peux pas aider avec ce type de demande.";

const REFUSAL_BY_LOCALE: Record<string, string> = {
  fr: AI_REFUSAL_MESSAGE,
  en: "I'm MMD AI. I can help with MMD Delivery, educational topics, religion, useful general information, and finding public places. I can't help with this kind of request.",
  es: "Soy MMD AI. Puedo ayudar con MMD Delivery, temas educativos, religión, información general útil y búsqueda de lugares públicos. No puedo ayudar con este tipo de solicitud.",
  ar: "أنا MMD AI. يمكنني المساعدة في MMD Delivery والمواضيع التعليمية والدين والمعلومات العامة المفيدة والبحث عن الأماكن العامة. لا يمكنني المساعدة في هذا النوع من الطلبات.",
  zh: "我是 MMD AI。我可以协助 MMD Delivery、教育、宗教、有用的一般信息以及查找公共场所。我无法协助这类请求。",
  ff: AI_REFUSAL_MESSAGE,
};

export function getAiRefusalMessage(locale?: string): string {
  const key = String(locale ?? "en").split("-")[0].toLowerCase();
  return REFUSAL_BY_LOCALE[key] ?? REFUSAL_BY_LOCALE.en;
}

export function normalizeAiGuardText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PLACE_SEARCH_SIGNAL =
  /\b(near(est)?|closest|nearby|pres de moi|proche|proximite|a proximite|around me|find me|trouve[- ]moi|ou (est|sont)|where (is|are)|adresse|address|lieu public|public place)\b/;

const PLACE_CATEGORY_SIGNAL =
  /\b(hopital|hospital|clinique|clinic|pharmacie|pharmacy|ecole|school|universite|university|creche|daycare|mosquee|mosque|eglise|church|synagogue|lieu de culte|worship|station[- ]service|gas station|fuel|poste de police|police station|caserne|fire (station|department)|hotel|motel|parking|parkings|parc|playground|aire de jeux|supermarche|supermarket|epicerie|grocery|centre commercial|mall|banque|bank|atm|distributeur|restaurant|cafe|gare|train station|arret de bus|bus stop|aeroport|airport|walmart)\b/;

const HOW_TO_PREFIX =
  /\b(how (can|do|to)|comment (faire|voler|tuer|pirater|fabriquer)|aide[- ]moi a|help me (to )?(steal|hack|kill|hurt|attack)|instructions (pour|to))\b/;

function recentUserCorpus(history?: AiGuardHistoryTurn[]): string {
  return (history ?? [])
    .filter((turn) => turn.role === "user")
    .slice(-4)
    .map((turn) => normalizeAiGuardText(turn.content))
    .join("\n");
}

export function isPublicPlaceSearchIntent(message: string): boolean {
  const text = normalizeAiGuardText(message);
  if (!text) return false;
  if (PLACE_CATEGORY_SIGNAL.test(text) && PLACE_SEARCH_SIGNAL.test(text)) return true;
  if (
    /\b(endroit (ou|pour) (garer|prier|jouer)|place to (park|pray|play)|besoin d'un endroit|i need a place)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(salle d'urgence|emergency room)\b/.test(text)) return true;
  return false;
}

function isAmbiguousSexualFollowUp(text: string): boolean {
  return (
    /\b(montre[- ]moi|show me|envoie[- ]moi|send me)\b/.test(text) &&
    /\b(images?|photos?|pictures?|nudes?|pics)\b/.test(text)
  );
}

function isPoliticsRequest(text: string): boolean {
  return (
    /\b(who should i vote|pour qui (dois|devrais)[- ]je voter|vote for|voter pour)\b/.test(text) ||
    /\b(election|elections|presidentielle|midterm|electoral|sondage electorale?|campagne electorale|candidat(e)?s?|parti politique|political party|debats politiques)\b/.test(
      text
    ) ||
    /\b(soutien|oppose|opposition) (au|a la|le|la)? ?(candidat|parti)\b/.test(text)
  );
}

function isSexualRequest(text: string, corpus: string): boolean {
  if (
    /\b(porn|porno|pornograph|pornhub|xvideos|xnxx|onlyfans|sex tape|nude pics|nudes\b|xxx video|acteurs? pornographiques?|actrices? pornographiques?|pornstar|positions? sexuelles?|contenu erotique|erotic content|images? pornographiques?)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(montre[- ]moi|show me).*(nue|nues|naked|porn|xxx|erotique)\b/.test(text)) return true;
  if (isAmbiguousSexualFollowUp(text) && /pornograph|porno|\bnudes?\b|\bxxx\b|onlyfans/.test(corpus)) {
    return true;
  }
  return false;
}

function isCrimeAssistance(text: string): boolean {
  if (/\b(hide (the )?evidence|cacher les preuves|echapper a la (police|loi)|evade (the )?(police|law))\b/.test(text)) {
    return true;
  }
  if (
    HOW_TO_PREFIX.test(text) &&
    /\b(steal|voler|rob|hack|pirater|tuer|kill|murder|poison|bombe|bomb|fraude|fraud|committer un crime)\b/.test(text)
  ) {
    return true;
  }
  return /\b(help me (commit|rob|steal)|aide[- ]moi a (voler|tuer|pirater|frauder))\b/.test(text);
}

function isDangerousAssistance(text: string): boolean {
  if (
    HOW_TO_PREFIX.test(text) &&
    /\b(hurt|blesser|attack|attaquer|weapon|arme|bypass (security|protection)|contourner (la )?(securite|protection)|compromise (a |the )?system)\b/.test(
      text
    )
  ) {
    return true;
  }
  return /\b(how to (make|build) (a )?(bomb|weapon|poison)|comment (fabriquer|faire) (une )?(bombe|arme))\b/.test(text);
}

function isPrivateDataRequest(text: string): boolean {
  return (
    /\b(ssn|social security number|numero de securite sociale|mot de passe|password of|iban|private (phone|email|address)|numero prive|adresse personnelle|maison de cette personne|home address of|son numero prive|donnees bancaires|bank (account|pin)|routing number)\b/.test(
      text
    ) || /\b(trouve[- ]moi la maison|find (me )?(his|her|their) (home|house|private address))\b/.test(text)
  );
}

function isCompetitorOpsRequest(text: string): boolean {
  const competitor =
    /\b(uber(\s+eats)?|lyft|doordash|grubhub|postmates|deliveroo|glovo|bolt|indrive|rappi|talabat|wolt|just\s*eat)\b/;
  if (!competitor.test(text)) return false;
  return /\b(order|book|commander?|commande|reserver|checkout|ride on|commande sur|how to use|utiliser l'application)\b/.test(
    text
  );
}

function isHarassmentGeneration(text: string): boolean {
  return (
    /\b(ecris|write|invente).*(insult|insulte|attaque personnelle)\b/.test(text) ||
    /\b(humilie|humiliate|campagne de denigrement|harcele cette personne|doxx)\b/.test(text)
  );
}

function isCryptoAdvice(text: string): boolean {
  const crypto = /\b(crypto|bitcoin|ethereum|btc|eth|token)\b/;
  if (!crypto.test(text)) return false;
  return /\b(buy|sell|acheter|vendre|investir|invest|trading|trader|quelle crypto|which crypto|va monter|will (go )?up|price prediction|recommandation)\b/.test(
    text
  );
}

export function evaluateAiContentPolicy(
  message: string,
  history?: AiGuardHistoryTurn[]
): AiGuardDecision {
  const text = normalizeAiGuardText(message);
  if (!text) return { action: "allow" };

  const corpus = `${recentUserCorpus(history)}\n${text}`;

  if (isSexualRequest(text, corpus)) return { action: "refuse", category: "sexual" };
  if (isPoliticsRequest(text)) return { action: "refuse", category: "politics" };
  if (isCrimeAssistance(text)) return { action: "refuse", category: "crime" };
  if (isDangerousAssistance(text)) return { action: "refuse", category: "dangerous" };
  if (isPrivateDataRequest(text)) return { action: "refuse", category: "private" };
  if (isCompetitorOpsRequest(text)) return { action: "refuse", category: "competitor_ops" };
  if (isHarassmentGeneration(text)) return { action: "refuse", category: "harassment" };
  if (isCryptoAdvice(text)) return { action: "refuse", category: "crypto" };

  return { action: "allow" };
}

export function detectEscalationReason(message: string): string | null {
  if (isPublicPlaceSearchIntent(message)) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

export function isBlockedAutoAction(actionName: string): boolean {
  return BLOCKED_AUTO_ACTIONS.has(actionName.trim().toLowerCase());
}

export const AI_DISCLAIMER =
  "MMD AI provides guidance only. For payments, refunds, cancellations, or disputes, contact MMD support.";

export const AI_SYSTEM_SAFETY_RULES = `
Safety rules (mandatory):
- You are useful: MMD Delivery, taxi, food, packages, tracking, FAQ, education, religion (neutral), general useful information, and public place / address search are allowed.
- Never refuse a question only because it is not about MMD.
- Strictly refuse: politics/elections, pornography/sexual content, crime how-to, dangerous attack/bypass instructions, private personal data, operational help for competing apps, harassment, crypto investment advice.
- If a request is refused by policy, do not explain internal rules.
- Never promise automatic refunds, payments, or compensation.
- Never confirm payment status as guaranteed.
- Never modify, cancel, or accept orders/missions automatically.
- Never change menu, prices, hours, or payouts.
- Never invent addresses, prices, reservations, orders, availability, or GPS coordinates.
- Public place search is allowed (hospital, school, mosque, store address, etc.). Operational booking/ordering on Uber, DoorDash, Lyft, and similar apps is not.
- If the user mentions accident, dispute, fraud, harassment, or emergency (and it is not a public-place lookup) → recommend human support immediately.
- If uncertain → explain clearly and offer Contact support or create_support_case.
- Do not expose sensitive data (full payment IDs, internal tokens, other users' data).
- Area estimates and ETAs are not live guarantees.
- Never use markdown links. Never emit href="#" or fake buttons. Only tool actions that map to real app screens.
- Never claim a taxi ride or food order was created or paid unless a real MMD tool/screen did it.
`.trim();
