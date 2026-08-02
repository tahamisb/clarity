"use client"

import { Layers } from "lucide-react"
import { useTimeFilter } from "@/lib/time-filter-context"
import { VERTICAL_OPTIONS, type VerticalFilter } from "@/lib/verticals"
import { useT, useTV } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Vertical filter — native <select> styled to match the topbar pills.
 * Sits beside the time-range control and governs every dashboard the same way.
 */
export function VerticalSelect({
  value,
  onChange,
  className,
}: {
  value: VerticalFilter
  onChange: (v: VerticalFilter) => void
  className?: string
}) {
  const t = useT()
  const tv = useTV()
  return (
    <label
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1.5",
        "text-xs font-semibold text-muted-foreground transition-colors focus-within:border-accent/50",
        value !== "all" && "border-primary/50 text-foreground",
        className,
      )}
      title={t("vertical.label")}
    >
      <Layers className="size-3.5 shrink-0" />
      <span className="sr-only">{t("vertical.label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as VerticalFilter)}
        className="max-w-32 cursor-pointer bg-transparent outline-none"
      >
        {VERTICAL_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {v === "all" ? t("vertical.all") : tv(v)}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Global vertical control wired to the app-wide filter context — mounted in
 * the Topbar next to the time range. Render-gated on hydration like
 * GlobalTimeRange.
 */
export function GlobalVerticalSelect({ className }: { className?: string }) {
  const { vertical, setVertical, hydrated } = useTimeFilter()
  if (!hydrated) return null
  return <VerticalSelect value={vertical} onChange={setVertical} className={className} />
}

/**
 * Small chip naming the vertical a highlight's data came from. Renders nothing
 * for null/undefined so it can be dropped onto any card unconditionally.
 */
export function VerticalBadge({
  vertical,
  className,
}: {
  vertical: string | null | undefined
  className?: string
}) {
  const t = useT()
  const tv = useTV()
  if (!vertical) return null
  // "all" is the no-filter sentinel — the data spans every vertical, so say so
  // rather than naming one (numbers are blended, not that vertical's).
  const label = vertical === "all" ? t("vertical.all") : tv(vertical)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wide text-primary",
        className,
      )}
    >
      <Layers className="size-2.5" />
      {label}
    </span>
  )
}
