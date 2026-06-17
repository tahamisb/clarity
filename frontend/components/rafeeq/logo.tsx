import { cn } from "@/lib/utils"

export function RafeeqLogo({
  className,
  showArabic = true,
}: {
  className?: string
  showArabic?: boolean
}) {
  return (
    <div className={cn("flex items-center gap-2 leading-none", className)}>
      <span className="display-italic text-2xl tracking-tighter text-foreground">
        <span className="text-accent">R</span>afeeq
      </span>
      {showArabic && (
        <span
          dir="rtl"
          className="display-italic text-lg text-accent"
          aria-hidden="true"
        >
          رفيق
        </span>
      )}
    </div>
  )
}

export function LightningBolt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M13.5 2 4 14h6l-1.5 8L20 9h-6.5z" />
    </svg>
  )
}
