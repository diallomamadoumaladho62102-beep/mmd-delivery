#!/usr/bin/env node
/**
 * Generate Content modules, page.tsx wrappers, and a Supabase migration
 * from scripts/data/marketing-pages.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const data = JSON.parse(
  readFileSync(join(ROOT, "scripts/data/marketing-pages.json"), "utf8"),
);

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function sqlStr(s) {
  return String(s).replace(/'/g, "''");
}

function pageDir(route) {
  return join(ROOT, "apps/web/app", route.replace(/^\//, ""));
}

function contentPath(slug) {
  const pascal = slug.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
  // faq -> faqContent, how-it-works style not used here
  return join(ROOT, "apps/web/src/components/site", `${slug}Content.ts`);
}

function exportName(slug) {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function buildContentTs(page) {
  const Name = exportName(page.slug);
  const hasSteps = (page.profile || []).includes("how_it_works");
  const stepsConst = hasSteps
    ? `export const ${Name.toUpperCase()}_START_STEPS = ${JSON.stringify(page.steps || [], null, 2)} as const;\n\n`
    : "";

  const blocks = [];
  let sort = 10;
  for (const type of page.profile) {
    if (type === "hero") {
      const h = page.hero;
      blocks.push(`    {
      id: "${page.slug}-hero",
      ...base,
      block_type: "hero",
      sort_order: ${sort},
      payload: {
        eyebrow: ${JSON.stringify(h.eyebrow)},
        headline: ${JSON.stringify(h.headline)},
        headline_style: "solid",
        subheadline: ${JSON.stringify(h.subheadline)},
        showcase: "image",
        image_url: ${JSON.stringify(h.image)},
        benefits: ${JSON.stringify(h.benefits)},
        primary_ctas: [${JSON.stringify({ label: h.primary.label, href: h.primary.href, event: h.primary.event })}],
        secondary_ctas: [${JSON.stringify({ label: h.secondary.label, href: h.secondary.href, event: h.secondary.event })}],
      },
    }`);
    } else if (type === "features") {
      blocks.push(`    {
      id: "${page.slug}-features",
      ...base,
      block_type: "features",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.featuresTitle)},
        items: ${JSON.stringify(page.features)},
      },
    }`);
    } else if (type === "how_it_works") {
      blocks.push(`    {
      id: "${page.slug}-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.stepsTitle)},
        anchor: ${JSON.stringify(page.stepsAnchor)},
        steps: ${Name.toUpperCase()}_START_STEPS.map((step) => ({ ...step })),
      },
    }`);
    } else if (type === "rich_text") {
      blocks.push(`    {
      id: "${page.slug}-rich",
      ...base,
      block_type: "rich_text",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.richText.title)},
        body_md: ${JSON.stringify(page.richText.body)},
      },
    }`);
    } else if (type === "contact") {
      blocks.push(`    {
      id: "${page.slug}-contact",
      ...base,
      block_type: "contact",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.contactTitle || "Send a message")},
        anchor: "contact-form",
      },
    }`);
    } else if (type === "cta") {
      blocks.push(`    {
      id: "${page.slug}-cta",
      ...base,
      block_type: "cta",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.cta.title)},
        body: ${JSON.stringify(page.cta.body)},
        buttons: ${JSON.stringify(page.cta.buttons)},
      },
    }`);
    } else if (type === "faq") {
      blocks.push(`    {
      id: "${page.slug}-faq",
      ...base,
      block_type: "faq",
      sort_order: ${sort},
      payload: {
        title: ${JSON.stringify(page.faqTitle || "FAQ")},
        source: "site_faq",
      },
    }`);
    }
    sort += 10;
  }

  return `import type { SiteBlockRow } from "@/lib/siteCms";

export const ${Name.toUpperCase()}_SEO = {
  title: ${JSON.stringify(page.seoTitle)},
  description: ${JSON.stringify(page.seoDescription)},
  robots: "index,follow",
} as const;

${stepsConst}export function build${Name}FallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  return [
${blocks.join(",\n")}
  ];
}
`;
}

function buildPageTsx(page) {
  const Name = exportName(page.slug);
  const hasSteps = (page.profile || []).includes("how_it_works");
  const imports = hasSteps
    ? `${Name.toUpperCase()}_SEO,\n  ${Name.toUpperCase()}_START_STEPS,\n  build${Name}FallbackBlocks`
    : `${Name.toUpperCase()}_SEO,\n  build${Name}FallbackBlocks`;

  const howto = hasSteps
    ? `
  const stepsBlock = pageData?.blocks.find(
    (block) => block.block_type === "how_it_works",
  );
  const payload =
    stepsBlock?.payload && typeof stepsBlock.payload === "object"
      ? (stepsBlock.payload as Record<string, unknown>)
      : undefined;
  const steps = readSteps(payload);

  const jsonLd = (
    <HowToJsonLd
      name=${JSON.stringify(page.stepsTitle || page.title)}
      description={${Name.toUpperCase()}_SEO.description}
      path=${JSON.stringify(page.route)}
      anchor=${JSON.stringify(page.stepsAnchor || "start")}
      steps={steps}
    />
  );`
    : `
  const jsonLd = null;`;

  const readStepsFn = hasSteps
    ? `
function readSteps(payload: Record<string, unknown> | undefined) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const fromCms: { title: string; body?: string }[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const row = step as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const body =
      typeof row.body === "string"
        ? row.body.trim()
        : typeof row.description === "string"
          ? row.description.trim()
          : undefined;
    fromCms.push({ title, body });
  }
  return fromCms.length > 0
    ? fromCms
    : ${Name.toUpperCase()}_START_STEPS.map((step) => ({
        title: step.title,
        body: step.body,
      }));
}
`
    : "";

  return `import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
${hasSteps ? 'import HowToJsonLd from "@/components/site/HowToJsonLd";\n' : ""}import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  ${imports},
} from "@/components/site/${page.slug}Content";
import {
  cmsPageMetadata,
  loadSiteChrome,
  renderCmsPage,
} from "@/components/site/renderCmsPage";
import { getPublishedPageBySlug, listPublishedFaq } from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const meta = await cmsPageMetadata(${JSON.stringify(page.slug)}, ${JSON.stringify(page.title)});
    return {
      ...meta,
      title: meta.title || ${Name.toUpperCase()}_SEO.title,
      description: meta.description || ${Name.toUpperCase()}_SEO.description,
    };
  } catch {
    return {
      title: ${Name.toUpperCase()}_SEO.title,
      description: ${Name.toUpperCase()}_SEO.description,
      robots: ${Name.toUpperCase()}_SEO.robots,
    };
  }
}
${readStepsFn}
export default async function ${Name}MarketingPage() {
  const supabase = buildSupabaseAdminClient();
  const pageData = await getPublishedPageBySlug(supabase, ${JSON.stringify(page.slug)});
  const hasStructuredCms = Boolean(
    pageData?.blocks.some(
      (block) =>
        block.block_type === "hero" ||
        block.block_type === "features" ||
        block.block_type === "how_it_works" ||
        block.block_type === "contact",
    ),
  );
${howto}

  if (hasStructuredCms) {
    return (
      <>
        <div data-site-content-source="cms" hidden aria-hidden="true" />
        {jsonLd}
        {await renderCmsPage(${JSON.stringify(page.slug)})}
      </>
    );
  }

  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();
  const faqItems = await listPublishedFaq(supabase);

  return (
    <>
      <div data-site-content-source="fallback" hidden aria-hidden="true" />
      {jsonLd}
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <BlockRenderer
          blocks={build${Name}FallbackBlocks()}
          faqItems={faqItems.map((f) => ({
            id: String(f.id),
            question: String(f.question),
            answer_md: String(f.answer_md),
            category: f.category ? String(f.category) : undefined,
          }))}
        />
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
`;
}

function buildSqlPayload(page, type, sort) {
  if (type === "hero") {
    const h = page.hero;
    return `jsonb_build_object(
      'eyebrow', '${sqlStr(h.eyebrow)}',
      'headline', '${sqlStr(h.headline)}',
      'headline_style', 'solid',
      'subheadline', '${sqlStr(h.subheadline)}',
      'showcase', 'image',
      'image_url', '${sqlStr(h.image)}',
      'benefits', jsonb_build_array(${h.benefits.map((b) => `'${sqlStr(b)}'`).join(", ")}),
      'primary_ctas', jsonb_build_array(jsonb_build_object('label', '${sqlStr(h.primary.label)}', 'href', '${sqlStr(h.primary.href)}', 'event', '${sqlStr(h.primary.event)}')),
      'secondary_ctas', jsonb_build_array(jsonb_build_object('label', '${sqlStr(h.secondary.label)}', 'href', '${sqlStr(h.secondary.href)}', 'event', '${sqlStr(h.secondary.event)}'))
    )`;
  }
  if (type === "features") {
    const items = page.features
      .map(
        (f) =>
          `jsonb_build_object('title', '${sqlStr(f.title)}', 'description', '${sqlStr(f.description)}')`,
      )
      .join(",\n        ");
    return `jsonb_build_object(
      'title', '${sqlStr(page.featuresTitle)}',
      'items', jsonb_build_array(
        ${items}
      )
    )`;
  }
  if (type === "how_it_works") {
    const steps = page.steps
      .map(
        (s) =>
          `jsonb_build_object('title', '${sqlStr(s.title)}', 'body', '${sqlStr(s.body)}')`,
      )
      .join(",\n        ");
    return `jsonb_build_object(
      'title', '${sqlStr(page.stepsTitle)}',
      'anchor', '${sqlStr(page.stepsAnchor)}',
      'steps', jsonb_build_array(
        ${steps}
      )
    )`;
  }
  if (type === "rich_text") {
    return `jsonb_build_object(
      'title', '${sqlStr(page.richText.title)}',
      'body_md', '${sqlStr(page.richText.body)}'
    )`;
  }
  if (type === "contact") {
    return `jsonb_build_object(
      'title', '${sqlStr(page.contactTitle || "Send a message")}',
      'anchor', 'contact-form'
    )`;
  }
  if (type === "cta") {
    const buttons = page.cta.buttons
      .map(
        (b) =>
          `jsonb_build_object('label', '${sqlStr(b.label)}', 'href', '${sqlStr(b.href)}', 'event', '${sqlStr(b.event)}')`,
      )
      .join(", ");
    return `jsonb_build_object(
      'title', '${sqlStr(page.cta.title)}',
      'body', '${sqlStr(page.cta.body)}',
      'buttons', jsonb_build_array(${buttons})
    )`;
  }
  if (type === "faq") {
    return `jsonb_build_object(
      'title', '${sqlStr(page.faqTitle || "FAQ")}',
      'source', 'site_faq'
    )`;
  }
  return `jsonb_build_object()`;
}

function buildMigration(pages) {
  const chunks = pages.map((page) => {
    let sort = 10;
    const inserts = page.profile
      .map((type) => {
        const payload = buildSqlPayload(page, type, sort);
        const row = `(
    pid, '${type}', ${sort}, true, 'published', now(),
    ${payload}
  )`;
        sort += 10;
        return row;
      })
      .join(",\n  ");

    return `
  -- ${page.slug}
  select id into pid from public.site_pages where locale = 'en' and slug = '${sqlStr(page.slug)}';
  if pid is null then
    insert into public.site_pages (locale, slug, title, status, seo)
    values (
      'en',
      '${sqlStr(page.slug)}',
      '${sqlStr(page.title)}',
      'published',
      jsonb_build_object(
        'title', '${sqlStr(page.seoTitle)}',
        'description', '${sqlStr(page.seoDescription)}',
        'robots', 'index,follow'
      )
    )
    returning id into pid;
  else
    update public.site_pages
    set
      title = '${sqlStr(page.title)}',
      seo = jsonb_build_object(
        'title', '${sqlStr(page.seoTitle)}',
        'description', '${sqlStr(page.seoDescription)}',
        'robots', 'index,follow'
      )
    where id = pid;
  end if;

  delete from public.site_page_blocks where page_id = pid;

  insert into public.site_page_blocks (
    page_id, block_type, sort_order, visible, status, published_at, payload
  ) values
  ${inserts};
`;
  });

  return `-- Upgrade remaining marketing pages to structured CMS compositions.

begin;

do $$
declare
  pid uuid;
begin
${chunks.join("\n")}
end $$;

commit;
`;
}

// Generate
for (const page of data.pages) {
  const cPath = contentPath(page.slug);
  writeFileSync(cPath, buildContentTs(page), "utf8");
  console.log("wrote", cPath);

  const dir = pageDir(page.route);
  mkdirSync(dir, { recursive: true });
  const pPath = join(dir, "page.tsx");
  writeFileSync(pPath, buildPageTsx(page), "utf8");
  console.log("wrote", pPath);
}

const mig = join(
  ROOT,
  "supabase/migrations/20261107200000_site_marketing_pages_wave.sql",
);
writeFileSync(mig, buildMigration(data.pages), "utf8");
console.log("wrote", mig);
console.log("OK", data.pages.length, "pages");
