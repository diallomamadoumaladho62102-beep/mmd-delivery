"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import type { SiteMenuItem, SiteSettingsPayload } from "@/lib/siteCms";
import NewsletterForm from "./NewsletterForm";
import SiteImage from "./SiteImage";
import {
  siteContainerClass,
  siteCssVars,
  siteLinkClass,
  sitePrimaryBtnClass,
  siteRootClass,
  siteTheme,
} from "./siteTheme";

type OverlayRow = {
  id: string;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  placement?: string | null;
  dismissible?: boolean | null;
};

export type SiteShellProps = {
  settings: SiteSettingsPayload;
  headerItems: SiteMenuItem[];
  footerItems: SiteMenuItem[];
  children: ReactNode;
  overlays?: OverlayRow[];
};

export default function SiteShell({
  settings,
  headerItems,
  footerItems,
  children,
  overlays = [],
}: SiteShellProps) {
  const brand = settings.brand_name || siteTheme.brandName;
  const logo = settings.logo_url || siteTheme.logoSrc;
  const slogan = settings.slogan || "We Deliver With Heart";
  const [navOpen, setNavOpen] = useState(false);
  const navId = useId();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("mmd_site_overlay_dismissed");
      if (raw) setDismissed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
  }, []);

  const popup = overlays.find(
    (o) => !dismissed[o.id] && (o.kind === "popup" || o.placement === "modal"),
  );

  useEffect(() => {
    if (!popup) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && popup && popup.dismissible !== false) {
        dismissOverlay(popup.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup]);

  function dismissOverlay(id: string) {
    setDismissed((prev) => {
      const next = { ...prev, [id]: true };
      try {
        sessionStorage.setItem("mmd_site_overlay_dismissed", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const topOverlays = overlays.filter(
    (o) =>
      !dismissed[o.id] &&
      (o.placement === "top" || !o.placement || o.kind === "banner" || o.kind === "announcement"),
  );
  const popupOverlays = overlays.filter(
    (o) => !dismissed[o.id] && (o.kind === "popup" || o.placement === "modal"),
  );

  const socials = Object.entries(settings.socials ?? {}).filter(
    ([, url]) => typeof url === "string" && url.trim().length > 0,
  );

  const year = new Date().getFullYear();

  return (
    <div className={siteRootClass}>
      <style dangerouslySetInnerHTML={{ __html: siteCssVars }} />
      <a
        href="#site-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900"
      >
        Skip to content
      </a>

      {topOverlays.map((o) => (
        <div
          key={o.id}
          role="region"
          aria-label={o.title || "Announcement"}
          className="border-b border-orange-400/20 bg-gradient-to-r from-orange-500/15 to-rose-500/15"
        >
          <div
            className={`${siteContainerClass} flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm`}
          >
            <div className="min-w-0 text-slate-100">
              {o.title ? <span className="font-semibold">{o.title}</span> : null}
              {o.body ? (
                <span className={o.title ? " ml-2 text-slate-300" : "text-slate-300"}>
                  {o.body}
                </span>
              ) : null}
              {o.cta_href && o.cta_label ? (
                <Link href={o.cta_href} className={`ml-3 ${siteLinkClass}`}>
                  {o.cta_label}
                </Link>
              ) : null}
            </div>
            {o.dismissible !== false ? (
              <button
                type="button"
                onClick={() => dismissOverlay(o.id)}
                className="rounded-md px-2 py-1 text-slate-400 hover:text-white"
                aria-label="Dismiss announcement"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/85 backdrop-blur-md">
        <div
          className={`${siteContainerClass} flex h-[4.5rem] items-center justify-between gap-4 sm:h-20`}
        >
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            aria-label={brand}
          >
            <SiteImage
              src={logo}
              alt={brand}
              width={64}
              height={64}
              className="h-14 w-14 rounded-2xl object-cover shadow-lg shadow-orange-500/35 ring-1 ring-orange-400/30 sm:h-16 sm:w-16"
              priority
            />
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold tracking-tight text-white sm:text-lg">
                {brand}
              </span>
              <span className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                {slogan}
              </span>
            </span>
          </Link>

          <nav
            className="hidden items-center gap-1 lg:flex"
            aria-label="Primary"
          >
            {headerItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                target={item.target === "_blank" ? "_blank" : undefined}
                rel={item.target === "_blank" ? "noopener noreferrer" : undefined}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/download"
              data-site-event="nav_download"
              className={`ml-2 ${sitePrimaryBtnClass}`}
            >
              Download
            </Link>
          </nav>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white lg:hidden"
            aria-expanded={navOpen}
            aria-controls={navId}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? "Close" : "Menu"}
          </button>
        </div>

        {navOpen ? (
          <nav
            id={navId}
            className="border-t border-white/10 bg-slate-950/95 lg:hidden"
            aria-label="Mobile"
          >
            <div className={`${siteContainerClass} flex flex-col gap-1 py-3`}>
              {headerItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  target={item.target === "_blank" ? "_blank" : undefined}
                  rel={item.target === "_blank" ? "noopener noreferrer" : undefined}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/5"
                  onClick={() => setNavOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/download"
                data-site-event="nav_download"
                className={`${sitePrimaryBtnClass} mt-2`}
                onClick={() => setNavOpen(false)}
              >
                Download
              </Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main id="site-main">{children}</main>

      <footer className="mt-10 border-t border-white/10 bg-slate-950/80">
        <div className={`${siteContainerClass} py-14`}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-3">
                <SiteImage
                  src={logo}
                  alt={brand}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-xl object-cover ring-1 ring-orange-400/25"
                />
                <div>
                  <span className="block font-semibold text-white">{brand}</span>
                  <span className="text-xs text-slate-400">{slogan}</span>
                </div>
              </div>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
                {settings.footer_blurb ||
                  settings.tagline ||
                  "Modern delivery infrastructure for clients, drivers, restaurants, sellers, and businesses."}
              </p>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                Explore
              </h2>
              <ul className="mt-4 space-y-2.5">
                {footerItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      target={item.target === "_blank" ? "_blank" : undefined}
                      rel={
                        item.target === "_blank" ? "noopener noreferrer" : undefined
                      }
                      className="text-sm text-slate-400 transition-colors hover:text-orange-300"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                Contact
              </h2>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
                {settings.support_email ? (
                  <li>
                    <a
                      href={`mailto:${settings.support_email}`}
                      className="hover:text-orange-300"
                    >
                      {settings.support_email}
                    </a>
                  </li>
                ) : null}
                {settings.support_phone ? (
                  <li>
                    <a
                      href={`tel:${settings.support_phone_tel || settings.support_phone}`}
                      className="hover:text-orange-300"
                    >
                      {settings.support_phone}
                    </a>
                  </li>
                ) : null}
                {settings.address ? <li>{settings.address}</li> : null}
              </ul>
              {socials.length > 0 ? (
                <ul className="mt-5 flex flex-wrap gap-3">
                  {socials.map(([name, url]) => (
                    <li key={name}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs capitalize text-slate-300 transition-colors hover:border-orange-400/40 hover:text-orange-200"
                      >
                        {name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div>
              <NewsletterForm />
            </div>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} {brand}. All rights reserved.
            </p>
            <p className="text-slate-600">Taxi · Food · Package · Marketplace · Business</p>
          </div>
        </div>
      </footer>

      {popupOverlays[0] ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`overlay-title-${popupOverlays[0].id}`}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl">
            {popupOverlays[0].title ? (
              <h2
                id={`overlay-title-${popupOverlays[0].id}`}
                className="text-lg font-semibold text-white"
              >
                {popupOverlays[0].title}
              </h2>
            ) : null}
            {popupOverlays[0].body ? (
              <p className="mt-2 text-sm text-slate-300">{popupOverlays[0].body}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              {popupOverlays[0].cta_href && popupOverlays[0].cta_label ? (
                <Link
                  href={popupOverlays[0].cta_href}
                  className={sitePrimaryBtnClass}
                  onClick={() => dismissOverlay(popupOverlays[0].id)}
                >
                  {popupOverlays[0].cta_label}
                </Link>
              ) : null}
              {popupOverlays[0].dismissible !== false ? (
                <button
                  type="button"
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
                  onClick={() => dismissOverlay(popupOverlays[0].id)}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
