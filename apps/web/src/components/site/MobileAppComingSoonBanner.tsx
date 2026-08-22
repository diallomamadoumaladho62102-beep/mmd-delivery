import { siteContainerClass } from "./siteTheme";
import { MOBILE_APP_COMING_SOON_BANNER } from "./mobileAppComingSoonBannerContent";

const { title: TITLE, body: BODY, storeBadges } = MOBILE_APP_COMING_SOON_BANNER;

/**
 * Static marketing banner — apps are not live yet; badges are non-links until store URLs exist.
 */
export default function MobileAppComingSoonBanner() {
  return (
    <div
      role="region"
      aria-label="Application mobile bientôt disponible"
      className="border-b border-orange-400/25 bg-gradient-to-r from-orange-500/20 via-amber-500/10 to-rose-500/20"
    >
      <div className={`${siteContainerClass} py-3 sm:py-3.5`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white sm:text-base">
              <span className="mr-1.5" aria-hidden="true">📱</span>
              {TITLE}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              {BODY}
            </p>
          </div>
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-2.5"
            aria-label="Boutiques d'applications — bientôt disponible"
          >
            <span
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-slate-900/50 px-3 py-1.5 text-xs font-medium text-slate-200 sm:text-sm"
              title="Application iOS — bientôt sur l'App Store"
            >
              <span aria-hidden="true">{storeBadges[0].icon}</span>
              <span>{storeBadges[0].platform}</span>
              <span className="text-slate-400">— {storeBadges[0].suffix}</span>
            </span>
            <span
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-slate-900/50 px-3 py-1.5 text-xs font-medium text-slate-200 sm:text-sm"
              title="Application Android — bientôt sur Google Play"
            >
              <span aria-hidden="true">{storeBadges[1].icon}</span>
              <span>{storeBadges[1].platform}</span>
              <span className="text-slate-400">— {storeBadges[1].suffix}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
