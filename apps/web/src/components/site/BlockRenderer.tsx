import Link from "next/link";
import type { ReactNode } from "react";
import type { SiteBlockRow } from "@/lib/siteCms";
import ContactForm from "./ContactForm";
import SiteImage from "./SiteImage";
import { renderSimpleMarkdown } from "./simpleMarkdown";
import {
  siteCardClass,
  siteChipClass,
  siteContainerClass,
  siteGradientTextClass,
  siteHeadingClass,
  sitePrimaryBtnClass,
  siteSecondaryBtnClass,
  siteSectionClass,
  siteSubheadingClass,
  siteTheme,
} from "./siteTheme";

export type FaqItem = {
  id?: string;
  question: string;
  answer_md: string;
  category?: string;
};

export type BlogPostTeaser = {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  published_at?: string | null;
  post_type?: string | null;
};

export type BlockRendererProps = {
  blocks: SiteBlockRow[];
  faqItems?: FaqItem[];
  posts?: BlogPostTeaser[];
};

type CtaButton = {
  label?: string;
  href?: string;
  event?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function CtaButtons({
  buttons,
  primary = true,
}: {
  buttons: CtaButton[];
  primary?: boolean;
}) {
  const cleaned = buttons
    .map((btn) => ({
      label: typeof btn.label === "string" ? btn.label.trim() : "",
      href: typeof btn.href === "string" ? btn.href.trim() : "",
      event: btn.event,
    }))
    .filter((btn) => btn.label && btn.href);
  if (!cleaned.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {cleaned.map((btn, i) => (
        <Link
          key={`${btn.href}-${btn.label}-${i}`}
          href={btn.href}
          data-site-event={btn.event || undefined}
          className={primary && i === 0 ? sitePrimaryBtnClass : siteSecondaryBtnClass}
        >
          {btn.label}
        </Link>
      ))}
    </div>
  );
}

function SectionWrap({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={siteSectionClass}>
      <div className={siteContainerClass}>{children}</div>
    </section>
  );
}

function HeroBlock({ payload }: { payload: Record<string, unknown> }) {
  const headline = str(payload.headline, siteTheme.brandName);
  const subheadline = str(payload.subheadline);
  const eyebrow = str(payload.eyebrow);
  const imageUrl = str(payload.image_url, siteTheme.heroImageSrc);
  const benefits = asArray<string>(payload.benefits).filter(
    (b) => typeof b === "string" && b.trim(),
  );
  const primary = asArray<CtaButton>(payload.primary_ctas);
  const secondary = asArray<CtaButton>(payload.secondary_ctas);

  return (
    <section className="relative overflow-hidden border-b border-white/5">
      <div
        className={`${siteContainerClass} grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24`}
      >
        <div>
          {eyebrow ? (
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-orange-300/90">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
            <span className={siteGradientTextClass}>{headline}</span>
          </h1>
          {subheadline ? (
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              {subheadline}
            </p>
          ) : null}
          {benefits.length > 0 ? (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Benefits">
              {benefits.map((b) => (
                <li key={b} className={siteChipClass}>
                  {b}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-8 space-y-3">
            <CtaButtons buttons={primary} primary />
            {secondary.length > 0 ? (
              <CtaButtons buttons={secondary} primary={false} />
            ) : null}
          </div>
        </div>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl shadow-2xl shadow-black/50">
          <SiteImage
            src={imageUrl}
            alt={headline}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover motion-safe:animate-[fadeIn_0.8s_ease-out]"
          />
        </div>
      </div>
    </section>
  );
}

function ServicesBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap id="services">
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      {str(payload.subtitle) ? (
        <p className={siteSubheadingClass}>{str(payload.subtitle)}</p>
      ) : null}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const title = str(item.title);
          const description = str(item.description);
          const href = str(item.href);
          const key = str(item.key, `${title}-${i}`);
          const inner = (
            <>
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              {description ? (
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
              ) : null}
            </>
          );
          return href ? (
            <Link key={key} href={href} className={`${siteCardClass} block`}>
              {inner}
            </Link>
          ) : (
            <div key={key} className={siteCardClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </SectionWrap>
  );
}

function FeaturesBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <div key={`${str(item.title)}-${i}`} className={siteCardClass}>
            <h3 className="text-base font-semibold text-white">{str(item.title)}</h3>
            {str(item.description) ? (
              <p className="mt-2 text-sm text-slate-400">{str(item.description)}</p>
            ) : null}
          </div>
        ))}
      </div>
    </SectionWrap>
  );
}

function MissionVisionValuesBlock({ payload }: { payload: Record<string, unknown> }) {
  const mission = asRecord(payload.mission);
  const vision = asRecord(payload.vision);
  const values = asArray<Record<string, unknown>>(payload.values);
  return (
    <SectionWrap>
      <div className="grid gap-6 lg:grid-cols-2">
        {str(mission.title) || str(mission.body) ? (
          <div className={siteCardClass}>
            <h2 className="text-xl font-semibold text-white">{str(mission.title, "Mission")}</h2>
            {str(mission.body) ? (
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{str(mission.body)}</p>
            ) : null}
          </div>
        ) : null}
        {str(vision.title) || str(vision.body) ? (
          <div className={siteCardClass}>
            <h2 className="text-xl font-semibold text-white">{str(vision.title, "Vision")}</h2>
            {str(vision.body) ? (
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{str(vision.body)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {values.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {values.map((v, i) => (
            <div key={`${str(v.title)}-${i}`} className={siteCardClass}>
              <h3 className="font-semibold text-orange-200">{str(v.title)}</h3>
              {str(v.body) ? (
                <p className="mt-2 text-sm text-slate-400">{str(v.body)}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </SectionWrap>
  );
}

function HowItWorksBlock({ payload }: { payload: Record<string, unknown> }) {
  const steps = asArray<Record<string, unknown>>(payload.steps);
  if (!steps.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={`${str(step.title)}-${i}`} className={siteCardClass}>
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-300">
              Step {i + 1}
            </span>
            <h3 className="mt-2 text-lg font-semibold text-white">{str(step.title)}</h3>
            {str(step.body) ? (
              <p className="mt-2 text-sm text-slate-400">{str(step.body)}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionWrap>
  );
}

function CtaBlock({ payload }: { payload: Record<string, unknown> }) {
  const buttons = asArray<CtaButton>(payload.buttons);
  return (
    <SectionWrap>
      <div className="rounded-3xl border border-orange-400/20 bg-gradient-to-br from-slate-900/90 to-slate-950 p-8 sm:p-12">
        {str(payload.title) ? (
          <h2 className="text-3xl font-semibold text-white">{str(payload.title)}</h2>
        ) : null}
        {str(payload.body) ? (
          <p className="mt-3 max-w-2xl text-slate-300">{str(payload.body)}</p>
        ) : null}
        <div className="mt-6">
          <CtaButtons buttons={buttons} />
        </div>
      </div>
    </SectionWrap>
  );
}

function FaqBlock({
  payload,
  faqItems,
}: {
  payload: Record<string, unknown>;
  faqItems?: FaqItem[];
}) {
  const embedded = asArray<Record<string, unknown>>(payload.items).map((item, i) => ({
    id: str(item.id, `faq-${i}`),
    question: str(item.question),
    answer_md: str(item.answer_md ?? item.answer),
  }));
  const items =
    embedded.length > 0
      ? embedded
      : (faqItems ?? []).map((f) => ({
          id: f.id,
          question: f.question,
          answer_md: f.answer_md,
        }));
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 divide-y divide-white/10 rounded-2xl border border-white/10 bg-slate-900/40">
        {items.map((item, i) => (
          <details key={item.id ?? i} className="group px-5 py-4">
            <summary className="cursor-pointer list-none font-medium text-white marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-4">
                {item.question}
                <span className="text-orange-300 transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <div className="mt-3 text-sm">{renderSimpleMarkdown(item.answer_md)}</div>
          </details>
        ))}
      </div>
    </SectionWrap>
  );
}

function RichTextBlock({ payload }: { payload: Record<string, unknown> }) {
  const body = str(payload.body_md ?? payload.body);
  if (!body && !str(payload.title)) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="prose-site mt-6 max-w-3xl">{renderSimpleMarkdown(body)}</div>
    </SectionWrap>
  );
}

function ContactBlock({ payload }: { payload: Record<string, unknown> }) {
  return (
    <SectionWrap>
      <ContactForm title={str(payload.title, "Send a message")} subtitle={str(payload.subtitle)} />
    </SectionWrap>
  );
}

function BlogTeaserBlock({
  payload,
  posts,
}: {
  payload: Record<string, unknown>;
  posts?: BlogPostTeaser[];
}) {
  const limit =
    typeof payload.limit === "number" && payload.limit > 0
      ? Math.min(12, payload.limit)
      : 3;
  const list = (posts ?? []).slice(0, limit);
  if (!list.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className={`${siteCardClass} block`}
          >
            <h3 className="text-lg font-semibold text-white">{post.title}</h3>
            {post.excerpt ? (
              <p className="mt-2 line-clamp-3 text-sm text-slate-400">{post.excerpt}</p>
            ) : null}
            {post.published_at ? (
              <p className="mt-3 text-xs text-slate-500">
                {new Date(post.published_at).toLocaleDateString()}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Link href="/blog" className={siteSecondaryBtnClass}>
          View all posts
        </Link>
      </div>
    </SectionWrap>
  );
}

function VideoBlock({ payload }: { payload: Record<string, unknown> }) {
  const src = str(payload.src ?? payload.url ?? payload.embed_url);
  if (!src) return null;
  const title = str(payload.title, "Video");
  const isYoutube =
    /youtube\.com|youtu\.be/i.test(src) || str(payload.provider) === "youtube";
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-6 aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black">
        {isYoutube ? (
          <iframe
            src={src.includes("embed") ? src : src}
            title={title}
            className="h-full w-full"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <video controls className="h-full w-full" src={src}>
            <track kind="captions" />
          </video>
        )}
      </div>
    </SectionWrap>
  );
}

function PartnersBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <ul className="mt-8 flex flex-wrap items-center gap-6">
        {items.map((item, i) => {
          const name = str(item.name, `Partner ${i + 1}`);
          const logo = str(item.logo_url ?? item.logo);
          const href = str(item.url ?? item.href);
          const content = logo ? (
            <SiteImage
              src={logo}
              alt={name}
              width={160}
              height={40}
              className="h-10 w-auto object-contain opacity-80"
            />
          ) : (
            <span className="text-sm font-medium text-slate-300">{name}</span>
          );
          return (
            <li key={`${name}-${i}`} className="rounded-xl border border-white/10 bg-slate-900/50 px-5 py-3">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {content}
                </a>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </SectionWrap>
  );
}

function TestimonialsBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <blockquote key={i} className={siteCardClass}>
            <p className="text-sm leading-relaxed text-slate-200">
              {str(item.quote ?? item.body)}
            </p>
            <footer className="mt-4 text-sm text-orange-200">
              {str(item.author ?? item.name)}
              {str(item.role) ? (
                <span className="text-slate-500"> — {str(item.role)}</span>
              ) : null}
            </footer>
          </blockquote>
        ))}
      </div>
    </SectionWrap>
  );
}

function StatisticsBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items).filter(
    (item) => str(item.value) && str(item.label),
  );
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <div key={`${str(item.label)}-${i}`} className={siteCardClass}>
            <dt className="text-sm text-slate-400">{str(item.label)}</dt>
            <dd className="mt-1 text-3xl font-semibold text-white">{str(item.value)}</dd>
          </div>
        ))}
      </dl>
    </SectionWrap>
  );
}

function CardsBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const href = str(item.href);
          const body = (
            <>
              <h3 className="text-lg font-semibold text-white">{str(item.title)}</h3>
              {str(item.description ?? item.body) ? (
                <p className="mt-2 text-sm text-slate-400">
                  {str(item.description ?? item.body)}
                </p>
              ) : null}
            </>
          );
          return href ? (
            <Link key={i} href={href} className={`${siteCardClass} block`}>
              {body}
            </Link>
          ) : (
            <div key={i} className={siteCardClass}>
              {body}
            </div>
          );
        })}
      </div>
    </SectionWrap>
  );
}

function GalleryBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items).filter((i) =>
    str(i.src ?? i.url),
  );
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <figure
            key={i}
            className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40"
          >
            <div className="relative aspect-[4/3] w-full">
              <SiteImage
                src={str(item.src ?? item.url)}
                alt={str(item.alt, str(item.caption) || "Gallery image")}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
              />
            </div>
            {str(item.caption) ? (
              <figcaption className="px-3 py-2 text-xs text-slate-400">
                {str(item.caption)}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </SectionWrap>
  );
}

function TimelineBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <ol className="mt-8 space-y-6 border-l border-orange-400/30 pl-6">
        {items.map((item, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[1.625rem] top-1.5 h-3 w-3 rounded-full bg-orange-400" />
            {str(item.date) ? (
              <p className="text-xs font-semibold uppercase tracking-wider text-orange-300">
                {str(item.date)}
              </p>
            ) : null}
            <h3 className="mt-1 font-semibold text-white">{str(item.title)}</h3>
            {str(item.body ?? item.description) ? (
              <p className="mt-1 text-sm text-slate-400">
                {str(item.body ?? item.description)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionWrap>
  );
}

function PricingBlock({ payload }: { payload: Record<string, unknown> }) {
  const items = asArray<Record<string, unknown>>(payload.items);
  if (!items.length) return null;
  return (
    <SectionWrap>
      {str(payload.title) ? <h2 className={siteHeadingClass}>{str(payload.title)}</h2> : null}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {items.map((item, i) => (
          <div key={i} className={siteCardClass}>
            <h3 className="text-lg font-semibold text-white">{str(item.title ?? item.name)}</h3>
            {str(item.price) ? (
              <p className="mt-2 text-3xl font-semibold text-orange-200">{str(item.price)}</p>
            ) : null}
            {str(item.description) ? (
              <p className="mt-2 text-sm text-slate-400">{str(item.description)}</p>
            ) : null}
            {asArray<string>(item.features).length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                {asArray<string>(item.features).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {str(item.href) && str(item.cta_label ?? item.button_label) ? (
              <Link
                href={str(item.href)}
                className={`${sitePrimaryBtnClass} mt-6`}
                data-site-event={str(item.event) || undefined}
              >
                {str(item.cta_label ?? item.button_label)}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </SectionWrap>
  );
}

export default function BlockRenderer({
  blocks,
  faqItems,
  posts,
}: BlockRendererProps) {
  return (
    <>
      {blocks.map((block) => {
        const payload = asRecord(block.payload);
        switch (block.block_type) {
          case "hero":
            return <HeroBlock key={block.id} payload={payload} />;
          case "services":
            return <ServicesBlock key={block.id} payload={payload} />;
          case "features":
            return <FeaturesBlock key={block.id} payload={payload} />;
          case "mission_vision_values":
            return <MissionVisionValuesBlock key={block.id} payload={payload} />;
          case "how_it_works":
            return <HowItWorksBlock key={block.id} payload={payload} />;
          case "cta":
            return <CtaBlock key={block.id} payload={payload} />;
          case "faq":
            return <FaqBlock key={block.id} payload={payload} faqItems={faqItems} />;
          case "rich_text":
            return <RichTextBlock key={block.id} payload={payload} />;
          case "contact":
            return <ContactBlock key={block.id} payload={payload} />;
          case "blog_teaser":
            return <BlogTeaserBlock key={block.id} payload={payload} posts={posts} />;
          case "video":
            return <VideoBlock key={block.id} payload={payload} />;
          case "partners":
            return <PartnersBlock key={block.id} payload={payload} />;
          case "testimonials":
            return <TestimonialsBlock key={block.id} payload={payload} />;
          case "statistics":
            return <StatisticsBlock key={block.id} payload={payload} />;
          case "cards":
            return <CardsBlock key={block.id} payload={payload} />;
          case "gallery":
            return <GalleryBlock key={block.id} payload={payload} />;
          case "timeline":
            return <TimelineBlock key={block.id} payload={payload} />;
          case "pricing":
            return <PricingBlock key={block.id} payload={payload} />;
          default:
            return null;
        }
      })}
    </>
  );
}
