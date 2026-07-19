import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    "bg-mmd-accent-strong text-white hover:bg-violet-700 border-transparent",
  secondary:
    "bg-white text-slate-900 border-slate-200 hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800 border-transparent",
  ghost: "bg-transparent text-violet-700 border-transparent hover:bg-violet-50",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
};

/** Shared web button — replaces the Phase-era stub. */
export default function Button({
  variant = "primary",
  loading = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled || loading);
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT_CLASS[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? "…" : children}
    </button>
  );
}
