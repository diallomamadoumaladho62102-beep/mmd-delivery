import SocialLinks from "@/components/site/SocialLinks";

/** Lightweight public footer for portal pages that are not wrapped in SiteShell. */
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-slate-50 px-4 py-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">MMD Delivery</p>
          <p className="mt-1 text-xs text-slate-500">
            © {year} MMD Delivery. All rights reserved.
          </p>
        </div>
        <SocialLinks
          variant="icons"
          showLabels={false}
          className="[&_a]:border-slate-200 [&_a]:bg-white [&_a]:text-slate-700 [&_a:hover]:border-orange-300 [&_a:hover]:text-orange-700"
        />
      </div>
    </footer>
  );
}
