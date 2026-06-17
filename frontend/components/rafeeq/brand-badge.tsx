import { cn } from "@/lib/utils"

type Variant =
  | "cyan"
  | "negative"
  | "positive"
  | "neutral"
  | "soft"
  | "ghost"
  | "brand"
  | "dark"

const VARIANTS: Record<Variant, string> = {
  cyan: "bg-brand-cyan text-[#08120f] -skew-x-6 font-extrabold",
  negative: "bg-negative text-white",
  positive: "bg-positive text-white",
  neutral: "bg-neutral text-[#2a1a00]",
  soft: "bg-accent/15 text-accent",
  ghost: "border border-border bg-secondary/60 text-muted-foreground",
  brand: "bg-primary text-primary-foreground",
  dark: "glass text-foreground",
}

export function BrandBadge({
  children,
  variant = "soft",
  className,
  uppercase,
}: {
  children: React.ReactNode
  variant?: Variant
  className?: string
  uppercase?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold leading-none",
        uppercase && "uppercase tracking-wide",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
