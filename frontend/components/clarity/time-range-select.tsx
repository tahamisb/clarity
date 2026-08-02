"use client"

import { CalendarRange } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTimeFilter } from "@/lib/time-filter-context"
import { TIME_RANGES, isCustomRange, rangeParams, type TimeRange } from "@/lib/time-range"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Popover with two native date inputs that emits a custom { start, end } range.
 * Styled to match the app's other topbar popups (see ProfileMenu in topbar.tsx).
 */
function CustomRangePicker({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (v: TimeRange) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = isCustomRange(value)

  // Prefill from the current custom range, else from the active preset's window.
  const seed = rangeParams(value)
  const [start, setStart] = useState(seed.start ?? "")
  const [end, setEnd] = useState(seed.end ?? "")

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const apply = () => {
    if (!start || !end) return
    // Guard against an inverted window (end before start).
    const [lo, hi] = start <= end ? [start, end] : [end, start]
    onChange({ start: lo, end: hi })
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={active ? `${value.start} → ${value.end}` : t("range.custom")}
        aria-label={t("range.custom")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex size-8 items-center justify-center rounded-full border transition-colors cursor-pointer",
          active
            ? "border-primary bg-primary text-primary-foreground shadow-sm"
            : "border-border bg-secondary/60 text-muted-foreground hover:text-foreground",
        )}
      >
        <CalendarRange className="size-4" />
      </button>

      {open && (
        <div className="glass-frosted absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl shadow-2xl">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{t("range.customTitle")}</p>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {t("range.start")}
              <input
                type="date"
                value={start}
                max={end || undefined}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-sm text-foreground focus:border-accent/50 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {t("range.end")}
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-sm text-foreground focus:border-accent/50 focus:outline-none"
              />
            </label>
            <button
              onClick={apply}
              disabled={!start || !end}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t("range.apply")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Segmented time-range control for the dashboards' charts/tables.
 * Matches the app's pill/segmented styling (see Settings page).
 *
 * `compact` uses the short labels (WTD/MTD/…) — used by the global Topbar
 * control where horizontal space is tight. The calendar icon opens a custom
 * date-range picker; selecting a custom range de-selects the presets.
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
      <CustomRangePicker value={value} onChange={onChange} />
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
