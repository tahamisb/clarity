import { cn } from "@/lib/utils"

/** Wordmark. Text, not artwork — restyle it here and every surface follows. */
export function ClarityLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "display-italic text-2xl leading-none tracking-tighter text-foreground",
        className,
      )}
    >
      <span className="text-accent">C</span>larity
    </span>
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
