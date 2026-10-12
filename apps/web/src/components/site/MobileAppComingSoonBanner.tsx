import { siteContainerClass } from "./siteTheme";
import { MOBILE_APP_COMING_SOON_BANNER } from "./mobileAppComingSoonBannerContent";

const { title: TITLE, body: BODY, ios, android } = MOBILE_APP_COMING_SOON_BANNER;

/** Public banner. iOS links to the verified App Store listing. Android stays unlabeled as a store until Play is public. */
export default function MobileAppComingSoonBanner() {
  return (
    <div
      role="region"
      aria-label="MMD Delivery mobile app"
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
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-2.5">
            <a
              href={ios.href}
              target="_blank"
              rel="noopener noreferrer"
              data-site-event="store_click_ios"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-slate-900/50 px-3 py-1.5 text-xs font-medium text-white hover:border-orange-300/60 hover:text-orange-100 sm:text-sm"
            >
              <span aria-hidden="true"></span>
              <span>{ios.label}</span>
            </a>
            <span
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-slate-900/50 px-3 py-1.5 text-xs font-medium text-slate-300 sm:text-sm"
              title="Google Play package has no public listing"
            >
              <span aria-hidden="true">▶</span>
              <span>{android.platform}</span>
              <span className="text-slate-400">— {android.note}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
