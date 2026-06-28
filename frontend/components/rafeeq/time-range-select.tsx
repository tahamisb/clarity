"use client"

import { CalendarRange } from "lucide-react"
import { useTimeFilter } from "@/lib/time-filter-context"
import { TIME_RANGES, type TimeRange } from "@/lib/time-range"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Segmented time-range control for the dashboards' charts/tables.
 * Matches the app's pill/segmented styling (see Settings page).
 *
 * `compact` uses the short labels (WTD/MTD/…) — used by the global Topbar
 * control where horizontal space is tight.
 */
export function TimeRangeSelect({
  value,
  onChange,
  compact = false,
  className,
}: {
  value: TimeRange
  onChange: (v: TimeRange) => void
  compact?: boolean
  className?: string
}) {
  const t = useT()
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <CalendarRange className="size-4 text-muted-foreground" />
      <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
        {TIME_RANGES.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={t(`range.${o.value}`)}
            aria-pressed={value === o.value}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              value === o.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {compact ? t(`range.short.${o.value}`) : t(`range.${o.value}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Global time-range control wired to the app-wide TimeFilter context. Mounted
 * once in the Topbar so it governs every tab. Render-gated on hydration to
 * avoid a flash of the default before the persisted value loads.
 */
export function GlobalTimeRange({ className }: { className?: string }) {
  const { range, setRange, hydrated } = useTimeFilter()
  if (!hydrated) return null
  return <TimeRangeSelect value={range} onChange={setRange} compact className={className} />
}
