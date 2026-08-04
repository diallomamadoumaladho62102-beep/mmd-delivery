"use client";

import {
  getActiveSocialLinks,
  type SocialLinkDefinition,
  type SocialNetworkId,
} from "@mmd/social-links";

type Variant = "footer" | "inline" | "icons" | "stacked";

type Props = {
  variant?: Variant;
  className?: string;
  /** Override the default active set (rare). */
  links?: SocialLinkDefinition[];
  showLabels?: boolean;
};

const ICON_PATHS: Record<SocialNetworkId, string> = {
  website:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  tiktok:
    "M16.6 5.82A4.27 4.27 0 0 1 14.54 4h-2.3v11.2a2.54 2.54 0 1 1-2.54-2.54c.2 0 .4.02.59.07v-2.36a4.9 4.9 0 0 0-.59-.04 4.9 4.9 0 1 0 4.9 4.9V9.43a6.72 6.72 0 0 0 3.91 1.24V8.35a4.3 4.3 0 0 1-1.91-.53z",
  instagram:
    "M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6m9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10m0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  facebook:
    "M14 8.16V6.16c0-.66.1-1.04 1.07-1.04H17V2h-2.66C11.46 2 10 3.64 10 6.6v1.56H8v3h2V22h4V11.16h2.7l.4-3z",
  x: "M3 3h4.2l4.1 5.7L16.5 3H21l-7.1 8.1L21.5 21H17.3l-4.5-6.2L7.5 21H3l7.4-8.4L3 3z",
  linkedin:
    "M6.5 8.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM4.75 10.25h3.5V20h-3.5v-9.75zM12.25 10.25h3.35v1.33h.05c.47-.89 1.61-1.83 3.31-1.83 3.54 0 4.19 2.33 4.19 5.36V20h-3.5v-4.45c0-1.06-.02-2.42-1.48-2.42-1.48 0-1.71 1.15-1.71 2.34V20h-3.5v-9.75z",
  youtube:
    "M23.5 7.2a3 3 0 0 0-2.1-2.1C19.5 4.5 12 4.5 12 4.5s-7.5 0-9.4.6A3 3 0 0 0 .5 7.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-4.8zM9.75 15.5v-7l6.25 3.5-6.25 3.5z",
};

function SocialIcon({ id }: { id: SocialNetworkId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 fill-current"
    >
      <path d={ICON_PATHS[id]} />
    </svg>
  );
}

export function SocialLinks({
  variant = "footer",
  className = "",
  links,
  showLabels,
}: Props) {
  const items = links ?? getActiveSocialLinks();
  if (!items.length) return null;

  const labels = showLabels ?? variant !== "icons";

  if (variant === "stacked") {
    return (
      <ul className={`space-y-2 text-sm ${className}`}>
        {items.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-slate-300 transition hover:text-orange-200"
            >
              <SocialIcon id={link.id} />
              <span>
                {link.label}
                {link.username ? (
                  <span className="text-slate-500"> · {link.username}</span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  const chip =
    variant === "icons"
      ? "inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:border-orange-400/40 hover:text-orange-200"
      : "inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-orange-400/40 hover:text-orange-200";

  return (
    <ul
      className={`flex flex-wrap items-center gap-3 ${className}`}
      aria-label="MMD Delivery on social media"
    >
      {items.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={chip}
            aria-label={`${link.label}${link.username ? ` ${link.username}` : ""}`}
            title={link.username ? `${link.label} ${link.username}` : link.label}
          >
            <SocialIcon id={link.id} />
            {labels ? <span>{link.label}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default SocialLinks;
