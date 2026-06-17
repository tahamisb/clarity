"use client"

import { RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { REFRESH_OPTIONS, useSettings } from "@/lib/settings-context"
import { cn } from "@/lib/utils"

function intervalLabel(sec: number): string {
  const match = REFRESH_OPTIONS.find((o) => o.value === sec)
  if (match && sec > 0) return `every ${match.label}`
  if (sec > 0) return `every ${sec}s`
  return "off"
}

function timeAgo(from: Date | null, now: number): string {
  if (!from) return "—"
  const secs = Math.max(0, Math.round((now - from.getTime()) / 1000))
  if (secs < 5) return "just now"
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

/**
 * Compact "auto-refresh · last updated · refresh now" strip shown on the data
 * dashboards. Reflects the cadence configured on the Settings page and lets the
 * user trigger an immediate refresh.
 */
export function RefreshStatus({
  lastUpdated,
  refreshing,
  onRefresh,
}: {
  lastUpdated: Date | null
  refreshing: boolean
  onRefresh: () => void
}) {
  const { settings } = useSettings()
  const [now, setNow] = useState(() => Date.now())

  // Tick once a second so the "x ago" label stays fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const auto = settings.refreshIntervalSec > 0

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="hidden items-center gap-1.5 sm:flex">
        <span
          className={cn(
            "size-1.5 rounded-full",
            auto ? "bg-positive animate-pulse" : "bg-muted-foreground/50",
          )}
        />
        Auto-refresh {intervalLabel(settings.refreshIntervalSec)}
      </span>
      <span className="hidden md:inline">·</span>
      <span>Updated {timeAgo(lastUpdated, now)}</span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        aria-label="Refresh now"
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  )
}
