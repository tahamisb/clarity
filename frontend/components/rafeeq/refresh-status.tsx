"use client"

import { RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useSettings } from "@/lib/settings-context"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type T = ReturnType<typeof useT>

function intervalLabel(sec: number, t: T): string {
  if (sec > 0) return t("refresh.every", { label: t(`refresh.${sec}`) })
  return t("refresh.offWord")
}

function timeAgo(from: Date | null, now: number, t: T): string {
  if (!from) return "—"
  const secs = Math.max(0, Math.round((now - from.getTime()) / 1000))
  if (secs < 5) return t("refresh.justNow")
  if (secs < 60) return t("refresh.secAgo", { n: secs })
  const mins = Math.floor(secs / 60)
  if (mins < 60) return t("refresh.minAgo", { n: mins })
  const hrs = Math.floor(mins / 60)
  return t("refresh.hrAgo", { n: hrs })
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
  const t = useT()
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
        {t("refresh.autoRefresh")} {intervalLabel(settings.refreshIntervalSec, t)}
      </span>
      <span className="hidden md:inline">·</span>
      <span>{t("refresh.updated", { ago: timeAgo(lastUpdated, now, t) })}</span>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        aria-label={t("a11y.refreshNow")}
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        {refreshing ? t("refresh.refreshing") : t("refresh.refresh")}
      </button>
    </div>
  )
}
