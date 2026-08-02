"use client"

import { useTV } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type BreakdownRow = {
  label: string
  /** Contribution size (e.g. cancelled orders) — drives the bar width. */
  value: number
  /** Optional rate shown next to the value (e.g. that contributor's cancel %). */
  pct?: number | null
}

/**
 * Wraps any stat/card and reveals a "top contributors" panel on hover or
 * keyboard focus. Pure CSS (group-hover) — no state, no positioning library.
 * Renders children untouched when there are no rows to show.
 */
export function HoverBreakdown({
  title,
  rows,
  children,
  className,
}: {
  title: string
  rows: BreakdownRow[]
  children: React.ReactNode
  className?: string
}) {
  const tv = useTV()
  if (!rows.length) return <>{children}</>
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <div className={cn("group relative", className)} tabIndex={0}>
      {children}
      <div
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute start-0 top-full z-40 mt-2 w-72 rounded-xl p-4 opacity-0 shadow-2xl",
          "glass-frosted transition-opacity duration-150",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
        )}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground" title={r.label}>
                  {tv(r.label)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {r.value.toLocaleString()}
                  {/* Sub-1% shares (e.g. a vendor's slice of a vertical rate) need
                      2 decimals or they all collapse to "0.1%". */}
                  {r.pct != null ? ` · ${r.pct.toFixed(r.pct !== 0 && Math.abs(r.pct) < 1 ? 2 : 1)}%` : ""}
                </span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(r.value / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
