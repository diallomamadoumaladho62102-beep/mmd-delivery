import Image from "next/image";

export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-950 px-6 text-center text-white">
      <Image
        src="/brand/mmd-logo.png"
        alt="MMD Delivery"
        width={240}
        height={155}
        priority
        className="h-auto w-52 rounded-xl bg-white object-contain shadow-2xl"
      />
      <p className="text-sm font-semibold tracking-wide text-slate-300">
        MMD Delivery
      </p>
    </main>
  );
}
