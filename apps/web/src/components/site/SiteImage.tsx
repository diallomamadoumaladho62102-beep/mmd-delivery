import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  fill?: boolean;
  sizes?: string;
};

function isLocalSrc(src: string) {
  return src.startsWith("/") && !src.startsWith("//");
}

/**
 * Prefer next/image for local/remote CMS assets. Falls back to <img> for
 * exotic schemes that Next cannot optimize.
 */
export default function SiteImage({
  src,
  alt,
  width,
  height,
  className,
  priority,
  fill,
  sizes,
}: Props) {
  if (!src) return null;
  if (!isLocalSrc(src) && !/^https?:\/\//i.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} width={width} height={height} />;
  }

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes || "100vw"}
        className={className}
        priority={priority}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width || 1200}
      height={height || 800}
      sizes={sizes}
      className={className}
      priority={priority}
    />
  );
}
