"use client";

import Image from "next/image";
import { initialsFromName } from "@/lib/adminDriverDisplay";

export default function DriverAvatar({
  name,
  src,
  size = 48,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: number;
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        <Image src={src} alt="" fill className="object-cover" unoptimized />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-500">
          {initialsFromName(name)}
        </div>
      )}
    </div>
  );
}
