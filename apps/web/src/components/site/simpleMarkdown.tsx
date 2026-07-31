import type { ReactNode } from "react";
import { siteLinkClass } from "./siteTheme";

/**
 * Tiny markdown subset: paragraphs, **bold**, and [label](url) links.
 * No HTML passthrough.
 */
export function renderSimpleMarkdown(md: string): ReactNode {
  const text = String(md ?? "").trim();
  if (!text) return null;

  const paragraphs = text.split(/\n{2,}/);

  return paragraphs.map((para, i) => {
    const lines = para.split(/\n/).map((line, j) => (
      <span key={j}>
        {j > 0 ? <br /> : null}
        {renderInline(line)}
      </span>
    ));
    return (
      <p key={i} className="mb-4 last:mb-0 text-slate-300 leading-relaxed">
        {lines}
      </p>
    );
  });
}

function renderInline(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      nodes.push(line.slice(last, m.index));
    }
    const token = m[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const label = m[2] ?? "";
      const href = m[3] ?? "#";
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        <a
          key={key++}
          href={href}
          className={siteLinkClass}
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        >
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }

  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}
