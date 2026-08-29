import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SITE_LOCALE,
  getPublishedPageBySlug,
  listPublishedFaq,
} from "@/lib/siteCms/types";

export const PUBLIC_HELP_SLUGS = [
  "faq",
  "how-it-works",
  "company",
  "drivers",
  "restaurants",
  "marketplace",
  "contact",
  "privacy",
  "terms",
  "support",
  "careers",
  "partners",
  "press",
  "download",
  "cookies",
  "account-deletion",
  "sms",
] as const;

export type MmdHelpHit = {
  source: "faq" | "cms_page";
  title: string;
  excerpt: string;
  slug?: string;
  category?: string;
};

function tokenize(query: string): string[] {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
}

function scoreText(text: string, tokens: string[]): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function excerptOf(text: string, max = 280): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function payloadText(payload: Record<string, unknown>): string {
  const bits: string[] = [];
  for (const value of Object.values(payload ?? {})) {
    if (typeof value === "string") bits.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") bits.push(item);
        else if (item && typeof item === "object") {
          bits.push(payloadText(item as Record<string, unknown>));
        }
      }
    } else if (value && typeof value === "object") {
      bits.push(payloadText(value as Record<string, unknown>));
    }
  }
  return bits.join(" ");
}

export async function searchPublicMmdHelp(params: {
  supabase: SupabaseClient;
  query: string;
  locale?: string;
  limit?: number;
}): Promise<{ hits: MmdHelpHit[]; localeUsed: string; invented: false }> {
  const locale = String(params.locale ?? DEFAULT_SITE_LOCALE).split("-")[0] || "en";
  const limit = Math.min(8, Math.max(1, Math.trunc(Number(params.limit ?? 5))));
  const tokens = tokenize(params.query);

  const faq = await listPublishedFaq(params.supabase, locale);
  const faqFallback =
    locale !== DEFAULT_SITE_LOCALE && faq.length === 0
      ? await listPublishedFaq(params.supabase, DEFAULT_SITE_LOCALE)
      : faq;

  const hits: Array<MmdHelpHit & { score: number }> = [];

  for (const item of faqFallback) {
    const title = String(item.question ?? "").trim();
    const body = String(item.answer_md ?? "").trim();
    const score = tokens.length
      ? scoreText(`${title} ${body} ${item.category ?? ""}`, tokens)
      : 1;
    if (score <= 0) continue;
    hits.push({
      source: "faq",
      title,
      excerpt: excerptOf(body),
      category: String(item.category ?? "") || undefined,
      score,
    });
  }

  for (const slug of PUBLIC_HELP_SLUGS) {
    const page = await getPublishedPageBySlug(params.supabase, slug, locale);
    const resolved =
      page ??
      (locale !== DEFAULT_SITE_LOCALE
        ? await getPublishedPageBySlug(params.supabase, slug, DEFAULT_SITE_LOCALE)
        : null);
    if (!resolved) continue;
    const blockText = resolved.blocks.map((b) => payloadText(b.payload ?? {})).join(" ");
    const title = String(resolved.page.title ?? slug);
    const score = tokens.length ? scoreText(`${title} ${slug} ${blockText}`, tokens) : 1;
    if (score <= 0) continue;
    hits.push({
      source: "cms_page",
      title,
      excerpt: excerptOf(blockText || title),
      slug,
      score,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return {
    hits: hits.slice(0, limit).map(({ score: _score, ...hit }) => hit),
    localeUsed: locale,
    invented: false,
  };
}
