import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-center text-white">
      <div className="max-w-lg">
        <Image
          src="/brand/mmd-logo-transparent-v2.png"
          alt="MMD Delivery — We Deliver With Heart"
          width={280}
          height={181}
          priority
          className="mx-auto h-auto w-60 object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.55)]"
        />
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-red-300">
          Error 404
        </p>
        <h1 className="mt-3 text-4xl font-semibold">Page not found</h1>
        <p className="mt-4 text-slate-300">
          The page you requested does not exist or is no longer available.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-500"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
