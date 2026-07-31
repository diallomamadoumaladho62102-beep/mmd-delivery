import Link from "next/link";
import SiteImage from "./SiteImage";
import { siteTheme } from "./siteTheme";

const SERVICES = [
  {
    key: "taxi",
    title: "Taxi",
    blurb: "Quote · pay · ride · track",
    href: "/download",
    image: "/brand/services/taxi.webp",
    accent: "from-amber-500/30 to-orange-600/10",
  },
  {
    key: "food",
    title: "Food",
    blurb: "Restaurants to your door",
    href: "/p/restaurants",
    image: "/brand/services/food.webp",
    accent: "from-rose-500/30 to-orange-500/10",
  },
  {
    key: "package",
    title: "Package",
    blurb: "Pickup codes & live ETA",
    href: "/download",
    image: "/brand/services/package.webp",
    accent: "from-sky-500/25 to-indigo-500/10",
  },
  {
    key: "marketplace",
    title: "Marketplace",
    blurb: "Local sellers, built-in delivery",
    href: "/marketplace",
    image: "/brand/services/marketplace.webp",
    accent: "from-violet-500/25 to-fuchsia-500/10",
  },
  {
    key: "business",
    title: "Business",
    blurb: "Wallets, teams & approvals",
    href: "/p/business",
    image: "/brand/services/taxi.webp",
    accent: "from-emerald-500/25 to-teal-500/10",
  },
] as const;

/** Premium multi-service visual for the corporate hero. */
export default function HeroShowcase({
  brand = siteTheme.brandName,
}: {
  brand?: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-black p-4 shadow-2xl shadow-black/50 sm:p-5"
      aria-label={`${brand} services`}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-orange-500/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-rose-500/15 blur-3xl"
        aria-hidden
      />

      <div className="relative mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
            Platform
          </p>
          <p className="mt-1 text-sm font-medium text-white">
            Five services. One app.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          Live GPS · Stripe · Dispatch
        </div>
      </div>

      <ul className="relative grid grid-cols-2 gap-3 sm:grid-cols-6">
        {SERVICES.map((s, i) => (
          <li
            key={s.key}
            className={
              i === 0
                ? "col-span-2 sm:col-span-3"
                : i === 1
                  ? "col-span-2 sm:col-span-3"
                  : "col-span-1 sm:col-span-2"
            }
          >
            <Link
              href={s.href}
              className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${s.accent} p-3 transition duration-300 hover:border-orange-400/40 hover:bg-slate-900/80`}
            >
              <div className="relative mb-3 aspect-[16/10] w-full overflow-hidden rounded-xl bg-slate-950/60">
                <SiteImage
                  src={s.image}
                  alt={s.title}
                  fill
                  sizes="(max-width: 640px) 50vw, 280px"
                  className="object-cover transition duration-500 group-hover:scale-[1.04]"
                />
              </div>
              <p className="text-sm font-semibold text-white">{s.title}</p>
              <p className="mt-1 text-xs leading-snug text-slate-300">
                {s.blurb}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
