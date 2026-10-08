"use client";

import { setSafeImageSource } from "@/lib/safeMediaUrl";

type Props = {
  src: string | null | undefined;
  alt: string;
  className?: string;
};

/** Image element whose src is assigned only by setSafeImageSource. */
export function SafePublicImage({ src, alt, className }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- src is assigned by setSafeImageSource after the host allowlist
    <img
      alt={alt}
      className={className}
      ref={(node) => {
        setSafeImageSource(node, src);
      }}
    />
  );
}
