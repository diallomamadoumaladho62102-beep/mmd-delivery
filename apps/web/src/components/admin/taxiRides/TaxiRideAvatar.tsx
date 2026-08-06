"use client";

import Image from "next/image";
import { initialsFromName } from "@/lib/adminFoodOrderDisplay";

export default function TaxiRideAvatar({
  name,
  src,
  size = 40,
  rounded = "full",
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: number;
  rounded?: "full" | "lg";
}) {
  const radius = rounded === "full" ? "rounded-full" : "rounded-lg";
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-slate-100 ring-1 ring-slate-200 ${radius}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        <Image src={src} alt="" fill className="object-cover" unoptimized />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-slate-500">
          {initialsFromName(name)}
        </div>
      )}
    </div>
  );
}
