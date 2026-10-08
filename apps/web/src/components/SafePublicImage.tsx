import { safePublicImageSrc } from "@/lib/safeMediaUrl";

type Props = {
  src: string | null | undefined;
  alt: string;
  className?: string;
};

/**
 * Renders an image only after safePublicImageSrc rebuilds an allowlisted URL.
 * javascript: and unknown hosts never reach the DOM.
 */
export function SafePublicImage({ src, alt, className }: Props) {
  const safe = safePublicImageSrc(src);
  if (!safe) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- src is rebuilt by safePublicImageSrc
    <img src={safe} alt={alt} className={className} /> // codeql[js/xss-through-dom] -- src rebuilt from an allowlisted host
  );
}
