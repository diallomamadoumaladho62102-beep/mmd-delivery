import Image from "next/image";
import Link from "next/link";
import {
  OFFICIAL_WEBSITE_URL,
  SOCIAL_QR_TARGETS,
  getActiveSocialLinks,
} from "@mmd/social-links";
import SocialLinks from "@/components/site/SocialLinks";

export const metadata = {
  title: "MMD Delivery · Social & QR Kit",
  description:
    "Official MMD Delivery social links and printable QR codes for marketing materials.",
};

const KIT_LABELS = [
  "Business Cards",
  "Referral Cards",
  "Loyalty Cards",
  "Flyers",
  "Posters",
  "Restaurant Materials",
  "Driver Welcome Kit",
  "Merchant Kit",
  "Vehicle Stickers",
  "Roll-up Banners",
  "Presentation Slides",
  "Brochures",
  "Email Signatures",
  "Packaging Inserts",
] as const;

export default function SocialBrandKitPage() {
  const links = getActiveSocialLinks();

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-300">
          Marketing kit
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Official social links &amp; QR codes
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Single source of truth for MMD Delivery presence. Use these assets on
          cards, flyers, kits, email signatures, and packaging. TikTok product
          links always use the canonical profile; the share QR is optional for
          campaigns.
        </p>

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Follow MMD Delivery</h2>
          <div className="mt-4">
            <SocialLinks variant="footer" />
          </div>
          <ul className="mt-6 space-y-2 text-sm text-slate-300">
            {links.map((link) => (
              <li key={link.id}>
                <span className="font-medium text-white">{link.label}</span>
                {link.username ? (
                  <span className="text-slate-500"> · {link.username}</span>
                ) : null}
                <br />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-orange-300 hover:underline"
                >
                  {link.url}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Printable QR codes</h2>
          <p className="mt-1 text-sm text-slate-400">
            PNG (2048px, ECC H) and SVG available under{" "}
            <code className="text-orange-200">/brand/qr/</code>.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SOCIAL_QR_TARGETS.map((target) => (
              <article
                key={target.id}
                className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
              >
                <div className="flex items-center justify-center rounded-xl bg-white p-4">
                  <Image
                    src={`/brand/qr/${target.fileStem}.png`}
                    alt={`QR code for ${target.label}`}
                    width={220}
                    height={220}
                    className="h-auto w-full max-w-[220px]"
                  />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">
                  {target.label}
                </h3>
                <p className="mt-1 break-all text-xs text-slate-400">
                  {target.url}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <a
                    href={`/brand/qr/${target.fileStem}.png`}
                    className="rounded-lg border border-orange-400/30 px-2 py-1 text-orange-200"
                    download
                  >
                    PNG
                  </a>
                  <a
                    href={`/brand/qr/${target.fileStem}.svg`}
                    className="rounded-lg border border-orange-400/30 px-2 py-1 text-orange-200"
                    download
                  >
                    SVG
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Recommended kits</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {KIT_LABELS.map((kit) => (
              <li
                key={kit}
                className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2 text-sm text-slate-300"
              >
                {kit}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Website:{" "}
            <a href={OFFICIAL_WEBSITE_URL} className="text-orange-300">
              {OFFICIAL_WEBSITE_URL}
            </a>
          </p>
        </section>

        <p className="mt-8 text-sm">
          <Link href="/" className="text-orange-300 hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
    </main>
  );
}
