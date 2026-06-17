import { Construction } from "lucide-react"

/**
 * Wraps a feature that is not ready yet. The underlying UI is shown as a
 * preview but is fully non-interactive (blurred, dimmed, pointer events
 * disabled) with a "Work in progress" overlay on top.
 */
export function WorkInProgress({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="relative">
      {/* Preview of the eventual feature — disabled & faded */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none opacity-40 blur-[1.5px] saturate-50"
      >
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/40 p-6 text-center backdrop-blur-[1px]">
        <span className="flex items-center gap-2 rounded-full border border-accent/30 bg-card px-4 py-2 text-sm font-bold text-foreground shadow-sm">
          <Construction className="size-4 text-accent" />
          Work in progress
        </span>
        {note && (
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{note}</p>
        )}
      </div>
    </div>
  )
}

/** Small inline badge for section headers. */
export function WipBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
      <Construction className="size-3" />
      WIP
    </span>
  )
}
